import React, { useEffect, useState, useRef } from "react";

// 参考值
const symbols = ["btcusdt", "ethusdt"];
const spotWsBase = "wss://stream.binance.com:9443/ws";
const contractWsBase = "wss://fstream.binance.com/ws";

export default function CustomRealtime() {
  const [data, setData] = useState([]);
  const spotPrices = useRef({});
  const wsRefs = useRef({ spot: null, contract: null });

  const [n, setN] = useState(300); // 本金默认300
  const [k, setK] = useState(5); // 杠杆默认5
  const [a, setA] = useState(0.4); // 现货滑点默认40%
  const [b, setB] = useState(0.08); // 合约滑点默认8%
  const [spotFeeRate, setSpotFeeRate] = useState(0.08);  // 现货手续费默认8%
  const [futureFeeRate, setFutureFeeRate] = useState(0.1); // 合约手续费默认10%
  const [borrowRate, setBorrowRate] = useState(0.01);     // 借贷利率默认1%
  const [constantBasis, setConstantBasis] = useState(0.1); // 常驻基差默认0.1%
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [maxPosition, setMaxPosition] = useState(null);
  const [upperPrice, setUpperPrice] = useState(null);
  const [lowerPrice, setLowerPrice] = useState(null);

  const calculateScore = (basisRate, predictedFundingRate, leverage, periodNum) => {
    const tradingCost = (spotFeeRate + futureFeeRate) * leverage + borrowRate * leverage * periodNum / 2;
    const adjustedBasis = Math.abs(constantBasis) > Math.abs(basisRate) ? basisRate : basisRate - Math.sign(basisRate) * constantBasis;

    const grossProfit = (adjustedBasis - predictedFundingRate) * leverage / 2;
    const rawScore = Math.abs(grossProfit) > tradingCost
      ? grossProfit - tradingCost
      : grossProfit;

    return rawScore.toFixed(4);
  };

  useEffect(() => {
    const spotWs = new WebSocket(spotWsBase);
    wsRefs.current.spot = spotWs;
    spotWs.onopen = () => {
      spotWs.send(
        JSON.stringify({
          method: "SUBSCRIBE",
          params: symbols.map((s) => ${s}@ticker),
          id: 1,
        })
      );
    };
    spotWs.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      const symbol = msg.s?.toLowerCase();
      const price = parseFloat(msg.c);
      if (symbol && price) {
        spotPrices.current[symbol] = price;
      }
    };

    const contractWs = new WebSocket(contractWsBase);
    wsRefs.current.contract = contractWs;
    contractWs.onopen = () => {
      contractWs.send(
        JSON.stringify({
          method: "SUBSCRIBE",
          params: symbols.map((s) => ${s}@ticker),
          id: 2,
        })
      );
    };
    contractWs.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      const { s: symbol, c: contractPrice, r: fundingRate } = msg;
      const symbolKey = symbol?.toLowerCase();
      const spotPrice = spotPrices.current[symbolKey];

      if (!spotPrice) return;
      const contract = parseFloat(contractPrice);
      const basisRate = ((contract - spotPrice) / spotPrice) * 100;
      const predictedFundingRate = parseFloat(fundingRate);

      const score = calculateScore(basisRate, predictedFundingRate, k, 8);

      const now = new Date();
      const row = {
        time: now,
        coin: symbol.toUpperCase().replace("USDT", ""),
        spotPrice: spotPrice.toFixed(4),
        contractPrice: contract.toFixed(4),
        basisRate: basisRate.toFixed(2),
        fundingRate: (predictedFundingRate * 100).toFixed(4),
        riskFreeRate: score,
      };
      setData((prev) => [row, ...prev.slice(0, 9)]);

      const maxPrice = Math.max(spotPrice, contract);
      const maxPosition = (k * n) / maxPrice;

      let upperPrice, lowerPrice;
      if (score > 0) {
        upperPrice = Math.max(spotPrice * (1 + (1 - a) / k), contract * (1 - (1 - b) / k));
        lowerPrice = Math.min(spotPrice * (1 + (1 - a) / k), contract * (1 - (1 - b) / k));
      } else {
        upperPrice = Math.max(spotPrice * (1 - (1 - a) / k), contract * (1 + (1 - b) / k));
        lowerPrice = Math.min(spotPrice * (1 - (1 - a) / k), contract * (1 + (1 - b) / k));
      }

      setMaxPosition(maxPosition);
      setUpperPrice(upperPrice);
      setLowerPrice(lowerPrice);
    };

    return () => {
      wsRefs.current.spot?.close();
      wsRefs.current.contract?.close();
    };
  }, [k, n, a, b, spotFeeRate, futureFeeRate, borrowRate, constantBasis]);

  return (
    <div className="container">
      <table>
        <thead>
          <tr>
            <th>时间</th>
            <th>币种</th>
            <th>现货价</th>
            <th>合约价</th>
            <th>基差率%</th>
            <th>预期资金费率%</th>
            <th>无风险利率</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i}>
              <td>{new Date(row.time).toLocaleTimeString()}</td>
              <td>{row.coin}</td>
              <td>{row.spotPrice}</td>
              <td>{row.contractPrice}</td>
              <td>{row.basisRate}</td>
              <td>{row.fundingRate}</td>
              <td>{row.riskFreeRate}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
