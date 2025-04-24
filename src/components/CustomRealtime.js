import React, { useEffect, useState, useRef } from "react";

const spotWsBase = "wss://stream.binance.com:9443/ws";
const contractWsBase = "wss://fstream.binance.com/ws";

export default function CustomRealtime() {
  const [data, setData] = useState([]);
  const spotPrices = useRef({});
  const wsRefs = useRef({ spot: null, contract: null });

  const [n, setN] = useState(300);
  const [k, setK] = useState(5);
  const [a, setA] = useState(0.4);
  const [b, setB] = useState(0.08);
  const [spotFeeRate, setSpotFeeRate] = useState(0.08);
  const [futureFeeRate, setFutureFeeRate] = useState(0.1);
  const [borrowRate, setBorrowRate] = useState(0.01);
  const [constantBasis, setConstantBasis] = useState(0.1);
  const [selectedSymbol, setSelectedSymbol] = useState("btc");
  const [symbols, setSymbols] = useState(["btcusdt", "ethusdt"]);
  const [maxPosition, setMaxPosition] = useState(null);
  const [upperPrice, setUpperPrice] = useState(null);
  const [lowerPrice, setLowerPrice] = useState(null);

  const calculateScore = (basisRate, predictedFundingRate, leverage, periodNum) => {
    const tradingCost =
      (spotFeeRate + futureFeeRate) * leverage + borrowRate * leverage * periodNum / 2;
    const adjustedBasis =
      Math.abs(constantBasis) > Math.abs(basisRate)
        ? basisRate
        : basisRate - Math.sign(basisRate) * constantBasis;

    const grossProfit = (adjustedBasis - predictedFundingRate) * leverage / 2;
    const rawScore =
      Math.abs(grossProfit) > tradingCost ? grossProfit - tradingCost : grossProfit;

    return rawScore.toFixed(3);
  };

  const handleSymbolInput = () => {
    const inputSymbols = selectedSymbol
      .split(",")
      .map((symbol) => symbol.trim().toLowerCase() + "usdt");
    setSymbols(inputSymbols);
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
    if (symbol && !isNaN(price)) {
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
    const symbolRaw = msg.s;
    const contractPriceRaw = msg.c;
    const fundingRateRaw = msg.r;

    // 🔍 Debug log
    console.log("合约返回：", {
      symbolRaw,
      contractPriceRaw,
      fundingRateRaw,
    });

    const symbolKey = symbolRaw?.toLowerCase();
    const spotPrice = spotPrices.current[symbolKey];

    if (!spotPrice) {
      console.warn("跳过该合约数据，因为未找到现货价格", symbolKey);
      return;
    }

    const contract = parseFloat(contractPriceRaw);
    const predictedFundingRate = parseFloat(fundingRateRaw);

    // ⛔ 检查 NaN 问题
    if (isNaN(predictedFundingRate)) {
      console.error("❌ fundingRate 为 NaN：", { symbolRaw, fundingRateRaw });
      return;
    }

    const basisRate = ((contract - spotPrice) / spotPrice) * 100;
    const score = calculateScore(basisRate, predictedFundingRate, k, 8);

    const now = new Date();
    const row = {
      time: now,
      coin: symbolRaw.toUpperCase().replace("USDT", ""),
      spotPrice: spotPrice,
      contractPrice: contract,
      basisRate: basisRate.toFixed(3),
      fundingRate: (predictedFundingRate * 100).toFixed(4),
      riskFreeRate: score,
    };

    setData((prev) => [row, ...prev.slice(0, 9)]);

    const maxPrice = Math.max(spotPrice, contract);
    const maxPosition = (k * n) / maxPrice;

    let upperPrice, lowerPrice;
    if (score > 0) {
      upperPrice = Math.max(
        spotPrice * (1 + (1 - a) / k),
        contract * (1 - (1 - b) / k)
      );
      lowerPrice = Math.min(
        spotPrice * (1 + (1 - a) / k),
        contract * (1 - (1 - b) / k)
      );
    } else {
      upperPrice = Math.max(
        spotPrice * (1 - (1 - a) / k),
        contract * (1 + (1 - b) / k)
      );
      lowerPrice = Math.min(
        spotPrice * (1 - (1 - a) / k),
        contract * (1 + (1 - b) / k)
      );
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
    <div className="container" style={{ textAlign: "center" }}>
      <div style={{ marginBottom: "20px" }}>
        <label>
          选择币种:
          <input
            type="text"
            value={selectedSymbol}
            onChange={(e) => setSelectedSymbol(e.target.value)}
            placeholder="请输入币种（例如 BTC,ETH）"
          />
          <button onClick={handleSymbolInput} style={{ marginLeft: "10px" }}>
            查询
          </button>
        </label>
      </div>

      {/* 参数输入 */}
      {[
        ["本金 (n)", n, setN],
        ["杠杆 (k)", k, setK],
        ["现货滑点 (a)", a, setA],
        ["合约滑点 (b)", b, setB],
        ["现货手续费", spotFeeRate, setSpotFeeRate],
        ["合约手续费", futureFeeRate, setFutureFeeRate],
        ["借贷利率", borrowRate, setBorrowRate],
        ["常驻基差", constantBasis, setConstantBasis],
      ].map(([label, val, setter], idx) => (
        <div key={idx} style={{ marginBottom: "10px" }}>
          <label>
            {label}:
            <input
              type="number"
              value={val}
              onChange={(e) => setter(Number(e.target.value))}
              step="0.01"
              min="0"
            />
          </label>
        </div>
      ))}

      <table
        style={{
          margin: "20px auto",
          borderCollapse: "collapse",
          width: "95%",
          border: "1px solid black",
        }}
      >
        <thead>
          <tr>
            <th style={thStyle}>时间</th>
            <th style={thStyle}>币种</th>
            <th style={thStyle}>现货价</th>
            <th style={thStyle}>合约价</th>
            <th style={thStyle}>基差率%</th>
            <th style={thStyle}>预期资金费率%</th>
            <th style={thStyle}>无风险利率</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i}>
              <td style={tdStyle}>{new Date(row.time).toLocaleTimeString()}</td>
              <td style={tdStyle}>{row.coin}</td>
              <td style={tdStyle}>{row.spotPrice}</td>
              <td style={tdStyle}>{row.contractPrice}</td>
              <td style={tdStyle}>{row.basisRate}</td>
              <td style={tdStyle}>{row.fundingRate}</td>
              <td style={tdStyle}>{row.riskFreeRate}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const thStyle = {
  border: "1px solid black",
  padding: "10px",
  fontWeight: "bold",
  background: "#f2f2f2",
};

const tdStyle = {
  border: "1px solid black",
  padding: "10px",
};
