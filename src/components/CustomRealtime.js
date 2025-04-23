import React, { useEffect, useState, useRef } from "react";

// 参考值
const spotWsBase = "wss://stream.binance.com:9443/ws";
const contractWsBase = "wss://fstream.binance.com/ws";

export default function CustomRealtime() {
  const [data, setData] = useState([]);
  const spotPrices = useRef({});
  const wsRefs = useRef({ spot: null, contract: null });

  // 参数管理
  const [n, setN] = useState(300); // 本金
  const [k, setK] = useState(5); // 杠杆
  const [a, setA] = useState(0.4); // 现货滑点
  const [b, setB] = useState(0.08); // 合约滑点
  const [spotFeeRate, setSpotFeeRate] = useState(0.08);  // 现货手续费
  const [futureFeeRate, setFutureFeeRate] = useState(0.1); // 合约手续费
  const [borrowRate, setBorrowRate] = useState(0.01);     // 借贷利率
  const [constantBasis, setConstantBasis] = useState(0.1); // 常驻基差
  const [selectedSymbol, setSelectedSymbol] = useState('btc'); // 默认选择BTC
  const [symbols, setSymbols] = useState(["btcusdt", "ethusdt"]); // 动态的符号列表
  const [maxPosition, setMaxPosition] = useState(null);
  const [upperPrice, setUpperPrice] = useState(null);
  const [lowerPrice, setLowerPrice] = useState(null);

  const [manualSpotPrice, setManualSpotPrice] = useState("");  // 手动现货价格
  const [manualFuturePrice, setManualFuturePrice] = useState("");  // 手动合约价格

  const calculateScore = (basisRate, predictedFundingRate, leverage, periodNum) => {
    const tradingCost = (spotFeeRate + futureFeeRate) * leverage + borrowRate * leverage * periodNum / 2;
    const adjustedBasis = Math.abs(constantBasis) > Math.abs(basisRate) ? basisRate : basisRate - Math.sign(basisRate) * constantBasis;

    const grossProfit = (adjustedBasis - predictedFundingRate) * leverage / 2;
    const rawScore = Math.abs(grossProfit) > tradingCost
      ? grossProfit - tradingCost
      : grossProfit;

    return rawScore.toFixed(4);
  };

  const handleSymbolInput = () => {
    // 1. 将输入的符号分割成数组，并补全每个符号的 USDT 后缀
    const inputSymbols = selectedSymbol
      .split(",") // 假设用户输入多个币种，用逗号分隔
      .map(symbol => symbol.trim().toLowerCase() + 'usdt'); // 补全USDT后缀

    setSymbols(inputSymbols); // 更新符号列表
  };

  useEffect(() => {
    const spotWs = new WebSocket(spotWsBase);
    wsRefs.current.spot = spotWs;
    spotWs.onopen = () => {
      spotWs.send(
        JSON.stringify({
          method: "SUBSCRIBE",
          params: symbols.map((s) => `${s}@ticker`),
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
          params: symbols.map((s) => `${s}@ticker`),
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
  }, [k, n, a, b, spotFeeRate, futureFeeRate, borrowRate, constantBasis, symbols]);

  return (
    <div className="container" style={{ textAlign: 'center' }}>
      {/* 输入框部分 */}
      <div style={{ marginBottom: '20px' }}>
        <label>
          选择币种:
          <input
            type="text"
            value={selectedSymbol}
            onChange={(e) => setSelectedSymbol(e.target.value)}
            placeholder="请输入币种（例如 BTC,ETH）"
          />
          <button onClick={handleSymbolInput} style={{ marginLeft: '10px' }}>查询</button>
        </label>
      </div>

      {/* 用户自定义参数输入框 */}
      <div style={{ marginBottom: '10px' }}>
        <label>
          本金 (n):
          <input
            type="number"
            value={n}
            onChange={(e) => setN(Number(e.target.value))}
            min="0"
          />
        </label>
      </div>

      <div style={{ marginBottom: '10px' }}>
        <label>
          杠杆 (k):
          <input
            type="number"
            value={k}
            onChange={(e) => setK(Number(e.target.value))}
            min="1"
          />
        </label>
      </div>

      <div style={{ marginBottom: '10px' }}>
        <label>
          现货滑点 (a):
          <input
            type="number"
            value={a}
            onChange={(e) => setA(Number(e.target.value))}
            step="0.01"
            min="0"
            max="1"
          />
        </label>
      </div>

      <div style={{ marginBottom: '10px' }}>
        <label>
          合约滑点 (b):
          <input
            type="number"
            value={b}
            onChange={(e) => setB(Number(e.target.value))}
            step="0.01"
            min="0"
            max="1"
          />
        </label>
      </div>

      <div style={{ marginBottom: '10px' }}>
        <label>
          现货手续费:
          <input
            type="number"
            value={spotFeeRate}
            onChange={(e) => setSpotFeeRate(Number(e.target.value))}
            step="0.01"
            min="0"
          />
        </label>
      </div>

      <div style={{ marginBottom: '10px' }}>
        <label>
          合约手续费:
          <input
            type="number"
            value={futureFeeRate}
            onChange={(e) => setFutureFeeRate(Number(e.target.value))}
            step="0.01"
            min="0"
          />
        </label>
      </div>

      <div style={{ marginBottom: '10px' }}>
        <label>
          借贷利率:
          <input
            type="number"
            value={borrowRate}
            onChange={(e) => setBorrowRate(Number(e.target.value))}
            step="0.01"
            min="0"
          />
        </label>
      </div>

      <div style={{ marginBottom: '10px' }}>
        <label>
          常驻基差:
          <input
            type="number"
            value={constantBasis}
            onChange={(e) => setConstantBasis(Number(e.target.value))}
            step="0.01"
            min="0"
          />
        </label>
      </div>

      {/* 显示结果的表格 */}
      <table style={{ margin: '20px auto', borderCollapse: 'collapse' }}>
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
}
