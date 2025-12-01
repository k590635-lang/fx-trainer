import { useEffect, useState, useRef } from 'react';

const API_BASE = "https://fx-trainer-backend.onrender.com";
const STORAGE_KEY = 'fx_trainer_saved_data_v1';

// URL に ?admin=1 が付いているときだけ管理者モード
const isAdmin =
  typeof window !== 'undefined' &&
  window.location.search.includes('admin=1');

/* ================================
   ローソク足チャートコンポーネント
   ================================ */
function CandleChart({ candles, currentIndex, position, lastTrade }) {
  const visibleCount = 100; // 直近何本を表示するか
  if (!candles || candles.length === 0) return null;

  const start = Math.max(0, currentIndex - visibleCount + 1);
  const end = currentIndex + 1;
  const slice = candles.slice(start, end);

  const width = 800;
  const height = 260;
  const paddingX = 20;
  const paddingY = 20;

  const prices = slice.flatMap((c) => [c.high, c.low]);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);

  const priceToY = (price) => {
    if (maxPrice === minPrice) return height / 2;
    const usableHeight = height - paddingY * 2;
    const ratio = (price - minPrice) / (maxPrice - minPrice);
    return paddingY + usableHeight * (1 - ratio);
  };

  const candleAreaWidth = width - paddingX * 2;
  const candleWidth = slice.length > 0 ? candleAreaWidth / slice.length : 0;

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      style={{
        border: '1px solid #ddd',
        background: '#ffffff',
        marginBottom: '12px',
      }}
    >
      {/* 価格レンジの目安線（上下） */}
      <line
        x1={paddingX}
        y1={priceToY(maxPrice)}
        x2={width - paddingX}
        y2={priceToY(maxPrice)}
        stroke="#eee"
      />
      <line
        x1={paddingX}
        y1={priceToY(minPrice)}
        x2={width - paddingX}
        y2={priceToY(minPrice)}
        stroke="#eee"
      />
      {/* 価格ラベル */}
      <text
        x={paddingX + 4}
        y={priceToY(maxPrice) - 4}
        fontSize="10"
        fill="#555"
      >
        {maxPrice}
      </text>
      <text
        x={paddingX + 4}
        y={priceToY(minPrice) + 12}
        fontSize="10"
        fill="#555"
      >
        {minPrice}
      </text>

      {slice.map((c, i) => {
        const xCenter = paddingX + i * candleWidth + candleWidth / 2;

        const yHigh = priceToY(c.high);
        const yLow = priceToY(c.low);
        const yOpen = priceToY(c.open);
        const yClose = priceToY(c.close);

        const isUp = c.close >= c.open;
        const bodyTop = isUp ? yClose : yOpen;
        const bodyBottom = isUp ? yOpen : yClose;
        const bodyHeight = Math.max(1, bodyBottom - bodyTop);

        const isCurrent = i === slice.length - 1;
        const color = isCurrent ? '#ff5722' : isUp ? '#1a9b55' : '#c0392b';

        // ★ グローバルな足インデックス（全体の何本目か）
        const globalIndex = start + i;

        // ★ エントリー・決済に該当するか判定
        const isEntryPos =
          position && globalIndex === position.entryIndex;

        const isLastTradeEntry =
          lastTrade && globalIndex === lastTrade.entryIndex;

        const isLastTradeExit =
          lastTrade && globalIndex === lastTrade.exitIndex;

        return (
          <g key={i}>
            {/* 高値〜安値のヒゲ */}
            <line
              x1={xCenter}
              y1={yHigh}
              x2={xCenter}
              y2={yLow}
              stroke={color}
              strokeWidth={1}
            />
            {/* 実体 */}
            <rect
              x={xCenter - Math.max(2, candleWidth * 0.3)}
              y={bodyTop}
              width={Math.max(2, candleWidth * 0.6)}
              height={bodyHeight}
              fill={color}
            />

            {/* ★ エントリー中ポジションの印（青丸） */}
            {isEntryPos && (
              <circle cx={xCenter} cy={yLow + 10} r={5} fill="#2962ff" />
            )}

            {/* ★ 直近トレードのエントリー（緑三角） */}
            {isLastTradeEntry && (
              <polygon
                points={`
                  ${xCenter},${yHigh - 10}
                  ${xCenter - 6},${yHigh - 2}
                  ${xCenter + 6},${yHigh - 2}
                `}
                fill="#2e7d32"
              />
            )}

            {/* ★ 直近トレードの決済（赤三角） */}
            {isLastTradeExit && (
              <polygon
                points={`
                  ${xCenter},${yLow + 10}
                  ${xCenter - 6},${yLow + 2}
                  ${xCenter + 6},${yLow + 2}
                `}
                fill="#d32f2f"
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

/* ================================
   メイン App コンポーネント
   ================================ */
function App() {
  const [backendStatus, setBackendStatus] = useState('loading...');
  const [uploadInfo, setUploadInfo] = useState(null);
  const [candles, setCandles] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(2000);
  const playTimerRef = useRef(null);

  // ★ 1ポジションだけ管理する
  const [position, setPosition] = useState(null);
  const [trades, setTrades] = useState([]);

  // ★ 利確・損切り（pips）入力用
  const [tpPipsInput, setTpPipsInput] = useState(''); // 利確
  const [slPipsInput, setSlPipsInput] = useState(''); // 損切り

  // バックエンドのヘルスチェック
  useEffect(() => {
    fetch(`${API_BASE}/api/health`)
      .then((res) => res.json())
      .then((data) => setBackendStatus(data.status))
      .catch(() => setBackendStatus('error'));
  }, []);

    // ★ 起動時：まず localStorage、なければバックエンドの共有データを読む
  useEffect(() => {
    const init = async () => {
      // 1) まず localStorage をチェック
      try {
        const raw = localStorage.getItem(STORAGE_KEY);

        if (raw) {
          const saved = JSON.parse(raw);
          if (saved.candles && saved.candles.length > 0) {
            setCandles(saved.candles);
            setUploadInfo(saved.uploadInfo || null);
            setCurrentIndex(0);
            setIsPlaying(false);
            setPosition(null);
            setTrades([]);
            return; // ← localStorage があればここで終了
          }
        }
      } catch (e) {
        console.error('前回データの読み込みに失敗しました', e);
      }

      // 2) localStorage に何もなければ、共有データをバックエンドから取得
      try {
        const res = await fetch(`${API_BASE}/api/default-candles`);
        const data = await res.json();

        if (
          data.success &&
          Array.isArray(data.candles) &&
          data.candles.length > 0
        ) {
          setCandles(data.candles);
          setUploadInfo(data.uploadInfo || null);
          setCurrentIndex(0);
          setIsPlaying(false);
          setPosition(null);
          setTrades([]);
          console.log('共有ローソク足を読み込みました:', data.candles.length);
        } else {
          console.log('共有データがまだありません');
        }
      } catch (e) {
        console.error('共有データの取得に失敗しました', e);
      }
    };

    init();
  }, []);


  // ★ 共有データ（バックエンド）からの初期読み込み
  useEffect(() => {
    // すでに localStorage から読み込んでいれば何もしない
    if (candles.length > 0) return;

    fetch(`${API_BASE}/api/default-candles`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.candles) && data.candles.length > 0) {
          setCandles(data.candles);
          setUploadInfo(data.uploadInfo || null);
          setCurrentIndex(0);
          setIsPlaying(false);
          setPosition(null);
          setTrades([]);
          console.log('共有ローソク足を読み込みました:', data.candles.length);
        }
      })
      .catch((err) => {
        console.warn('共有ローソク足の読み込みに失敗しました', err);
      });
  }, [candles.length]);

  // ★ CSV/データを更新したら localStorage に保存
  useEffect(() => {
    if (candles.length === 0) return;

    try {
      const payload = {
        candles,
        uploadInfo,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      console.error('データの保存に失敗しました', e);
    }
  }, [candles, uploadInfo]);

  // 自動再生用のタイマー制御
  useEffect(() => {
    if (isPlaying && candles.length > 0) {
      if (playTimerRef.current) {
        clearInterval(playTimerRef.current);
      }
      playTimerRef.current = setInterval(() => {
        setCurrentIndex((prev) => {
          if (prev >= candles.length - 1) {
            return prev; // 最後まで行ったら止まる
          }
          return prev + 1;
        });
      }, playSpeed);
    } else {
      if (playTimerRef.current) {
        clearInterval(playTimerRef.current);
        playTimerRef.current = null;
      }
    }

    return () => {
      if (playTimerRef.current) {
        clearInterval(playTimerRef.current);
        playTimerRef.current = null;
      }
    };
  }, [isPlaying, candles.length, playSpeed]);

  // CSVアップロード（admin だけ利用）
  const handleUpload = async (e) => {
    e.preventDefault();

    // form の中の <input name="csvFile" ...> を取得
    const fileInput = e.target.elements.csvFile;
    if (!fileInput || !fileInput.files || !fileInput.files[0]) {
      alert('CSVファイルを選択してください');
      return;
    }

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);

    try {
      console.log('start upload to:', `${API_BASE}/api/upload-csv`);

      const res = await fetch(`${API_BASE}/api/upload-csv`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        console.error('HTTP error:', res.status, res.statusText);
        alert('サーバーエラーが発生しました');
        return;
      }

      const data = await res.json();
      console.log('upload result:', data);
      console.log('candles length from backend:', data.candles?.length);

      if (!data.success) {
        alert('アップロードに失敗しました: ' + (data.message || ''));
        return;
      }

      const uploadedCandles = data.candles || [];
      if (!Array.isArray(uploadedCandles) || uploadedCandles.length === 0) {
        alert('有効なローソク足データがありません');
        return;
      }

      const uploadedInfo = {
        header: data.header,
        totalRows: data.totalRows,
        preview: data.preview,
        delimiter: data.delimiter,
      };

      // ここでチャート用の状態を更新
      setCandles(uploadedCandles);
      setUploadInfo(uploadedInfo);
      setCurrentIndex(0);
      setIsPlaying(false);
      setPosition(null);
      setTrades([]);

      // 画面上の「ローソク足本数」が 0 → ○○本 に変われば成功
    } catch (err) {
      console.error('アップロード時にエラーが発生しました', err);
      alert('アップロード中にエラーが発生しました');
    }
  };

  const currentCandle = candles[currentIndex] || null;
  const progressPct =
    candles.length > 0 ? (((currentIndex + 1) / candles.length) * 100).toFixed(1) : 0;

  // 足送りボタン
  const step = (delta) => {
    if (candles.length === 0) return;
    setCurrentIndex((prev) => {
      let next = prev + delta;
      if (next < 0) next = 0;
      if (next >= candles.length) next = candles.length - 1;
      return next;
    });
  };

  const togglePlay = () => {
    if (candles.length === 0) return;
    setIsPlaying((p) => !p);
  };

  const resetReplay = () => {
    setIsPlaying(false);
    setCurrentIndex(0);
  };

  /* ================================
     トレード関連
     ================================ */

  // JPYペアとして pips 計算（USDJPY など想定）
  const calcPips = (entryPrice, exitPrice, side) => {
    const sign = side === 'buy' ? 1 : -1;
    const diff = (exitPrice - entryPrice) * sign;
    const pips = diff * 10; // ★ ここで倍率調整
    return pips;
  };

  const handleOpenPosition = (side) => {
    if (!currentCandle) return;

    if (position) {
      alert('すでにポジションを保有しています（このバージョンは1ポジションのみ）。先に決済してください。');
      return;
    }

    const entryPrice = currentCandle.close; // 終値で約定とする
    const newPos = {
      side, // 'buy' or 'sell'
      entryPrice,
      entryIndex: currentIndex,
      entryTime: currentCandle.time,
    };

    setPosition(newPos);
  };

  const handleClosePosition = () => {
    if (!position || !currentCandle) return;

    const exitPrice = currentCandle.close;
    const exitTime = currentCandle.time;
    const pips = calcPips(position.entryPrice, exitPrice, position.side);

    const newTrade = {
      side: position.side,
      entryPrice: position.entryPrice,
      exitPrice,
      entryTime: position.entryTime,
      exitTime,
      entryIndex: position.entryIndex,
      exitIndex: currentIndex,
      pips,
    };

    setTrades((prev) => [...prev, newTrade]);
    setPosition(null);
  };

  const unrealizedPips = (() => {
    if (!position || !currentCandle) return null;
    return calcPips(position.entryPrice, currentCandle.close, position.side);
  })();

  // ★ 利確 / 損切り（pips指定）での自動決済
  useEffect(() => {
    if (!position || !currentCandle) return;

    // 入力は +20 でも -20 でも OK → 絶対値でそろえる
    const tp = Math.abs(Number(tpPipsInput) || 0); // 利確
    const sl = Math.abs(Number(slPipsInput) || 0); // 損切り

    // どちらも未設定なら何もしない
    if (tp === 0 && sl === 0) return;

    // 現在の含みpips
    const currentPips = calcPips(
      position.entryPrice,
      currentCandle.close,
      position.side
    );

    // ===== 利確判定（+tp 以上）=====
    if (tp > 0 && currentPips >= tp) {
      const exitPrice = currentCandle.close;
      const exitTime = currentCandle.time;

      const newTrade = {
        side: position.side,
        entryPrice: position.entryPrice,
        exitPrice,
        entryTime: position.entryTime,
        exitTime,
        entryIndex: position.entryIndex,
        exitIndex: currentIndex,
        pips: currentPips,
        auto: 'TP', // 自動利確
      };

      setTrades((prev) => [...prev, newTrade]);
      setPosition(null);
      return;
    }

    // ===== 損切り判定（-sl 以下）=====
    if (sl > 0 && currentPips <= -sl) {
      const exitPrice = currentCandle.close;
      const exitTime = currentCandle.time;

      const newTrade = {
        side: position.side,
        entryPrice: position.entryPrice,
        exitPrice,
        entryTime: position.entryTime,
        exitTime,
        entryIndex: position.entryIndex,
        exitIndex: currentIndex,
        pips: currentPips,
        auto: 'SL', // 自動損切り
      };

      setTrades((prev) => [...prev, newTrade]);
      setPosition(null);
      return;
    }
  }, [position, currentCandle, tpPipsInput, slPipsInput, currentIndex]);

  // 簡易統計
  const stats = (() => {
    if (trades.length === 0) {
      return {
        totalTrades: 0,
        winRate: 0,
        avgPips: 0,
        totalPips: 0,
      };
    }
    const totalPips = trades.reduce((sum, t) => sum + t.pips, 0);
    const wins = trades.filter((t) => t.pips > 0).length;
      const totalTrades = trades.length;
    const winRate = ((wins / totalTrades) * 100).toFixed(1);
    const avgPips = (totalPips / totalTrades).toFixed(1);
    return {
      totalTrades,
      winRate,
      avgPips,
      totalPips: totalPips.toFixed(1),
    };
  })();

  // 累積pipsの推移（エクイティカーブ用）
  const equity = trades.reduce((acc, t) => {
    const prev = acc.length > 0 ? acc[acc.length - 1] : 0;
    acc.push(prev + t.pips);
    return acc;
  }, []);

  const equityChart = (() => {
    if (equity.length === 0) return null;

    const width = 400;
    const height = 120;
    const paddingX = 20;
    const paddingY = 10;

    const min = Math.min(...equity, 0);
    const max = Math.max(...equity, 0);
    const range = max - min || 1;

    const points = equity.map((v, i) => {
      const x =
        paddingX +
        (equity.length === 1
          ? (width - paddingX * 2) / 2
          : ((width - paddingX * 2) * i) / (equity.length - 1));

      const ratio = (v - min) / range;
      const y = paddingY + (height - paddingY * 2) * (1 - ratio);
      return { x, y };
    });

    const zeroY =
      min <= 0 && max >= 0
        ? (() => {
            const ratio = (0 - min) / range;
            return paddingY + (height - paddingY * 2) * (1 - ratio);
          })()
        : null;

    return { width, height, paddingX, paddingY, points, zeroY, min, max };
  })();

  return (
    <div
      style={{
        padding: '20px',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
        maxWidth: '960px',
        marginLeft: 'auto',
        marginRight: 'auto',
        width: '100%',
        display: 'block',
        boxSizing: 'border-box',
      }}
    >
      <h1
        style={{
          textAlign: 'center',
          fontSize: '36px',
          fontWeight: '700',
          marginBottom: '24px',
        }}
      >
        FX トレーニングツール
      </h1>

      <p>バックエンドの状態: {backendStatus}</p>
      <p>現在読み込んでいるローソク足本数: {candles.length} 本</p>

      <hr style={{ margin: '20px 0' }} />

      {isAdmin && (
        <>
          {/* CSVアップロード */}
          <section>
            <h2>1. CSVアップロード</h2>
            <p>MT4 からエクスポートした 15分足（USDJPY など）の CSV を選択してください。</p>

            <form onSubmit={handleUpload}>
              <input
                type="file"
                name="csvFile"
                accept=".csv"
                style={{ marginRight: '12px' }}
              />
              <button type="submit">CSVアップロード</button>
            </form>
          </section>

          {/* プレビュー（先頭20行） */}
          {uploadInfo?.preview?.length > 0 && (
            <section style={{ marginTop: '20px' }}>
              <h3>プレビュー（先頭20行）</h3>
              <div
                style={{
                  overflowX: 'auto',
                  maxHeight: '240px',
                  border: '1px solid #ddd',
                }}
              >
                <table
                  style={{
                    borderCollapse: 'collapse',
                    width: '100%',
                    fontSize: '12px',
                  }}
                >
                  <thead>
                    <tr>
                      {uploadInfo.header.map((h, i) => (
                        <th
                          key={i}
                          style={{
                            border: '1px solid #ddd',
                            padding: '4px 6px',
                            background: '#f7f7f7',
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {uploadInfo.preview.map((row, ri) => (
                      <tr key={ri}>
                        {row.map((cell, ci) => (
                          <td
                            key={ci}
                            style={{
                              border: '1px solid #eee',
                              padding: '3px 6px',
                            }}
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}

      {/* ローソク足リプレイ */}
      {candles.length > 0 && (
        <section style={{ marginTop: '30px' }}>
          {/* 進捗・インデックス表示（位置系：上） */}
          <div
            style={{
              marginBottom: '6px',
              fontSize: '12px',
              color: '#555',
            }}
          >
            現在: {currentIndex + 1} / {candles.length} 本（{progressPct}%）
            {currentCandle ? `　日付/時間: ${currentCandle.time}` : ''}
          </div>

          {/* シークバーで任意の足へジャンプ（位置系：上） */}
          <div style={{ marginBottom: '12px' }}>
            <input
              type="range"
              min={0}
              max={candles.length - 1}
              value={currentIndex}
              onChange={(e) => {
                setIsPlaying(false); // シーク操作したら自動再生は停止
                setCurrentIndex(Number(e.target.value));
              }}
              style={{ width: '100%' }}
            />
          </div>

          {/* 再生・移動ボタン（位置系：上） */}
          <div style={{ marginBottom: '12px' }}>
            <button onClick={() => step(-10)}>« 10本戻る</button>{' '}
            <button onClick={() => step(-1)}>‹ 前の足</button>{' '}
            <button onClick={togglePlay}>
              {isPlaying ? '⏸ 一時停止' : '▶ 自動再生'}
            </button>{' '}
            <button onClick={() => step(1)}>次の足 ›</button>{' '}
            <button onClick={() => step(10)}>10本進む »</button>{' '}
            <button onClick={resetReplay}>⏮ 最初に戻る</button>
          </div>

          {/* チャート表示（直近100本） */}
          <CandleChart
            candles={candles}
            currentIndex={currentIndex}
            position={position}
            lastTrade={trades.length > 0 ? trades[trades.length - 1] : null}
          />

          {/* 売買ボタン：チャート直下 */}
          <div style={{ marginBottom: '12px', marginTop: '8px' }}>
            <button onClick={() => handleOpenPosition('buy')}>🟢 Buy（買い）</button>{' '}
            <button onClick={() => handleOpenPosition('sell')}>🔴 Sell（売り）</button>{' '}
            <button onClick={handleClosePosition}>⚪ Close（決済）</button>
          </div>

          {/* ★ 利確 / 損切り設定（pips） */}
          <div
            style={{
              marginTop: '14px',
              marginBottom: '16px',
              fontSize: '13px',
              background: '#f9f9f9',
              padding: '10px 14px',
              borderRadius: '6px',
              border: '1px solid '#ddd',
              width: 'fit-content',
            }}
          >
            <div style={{ marginBottom: '6px', fontWeight: 600 }}>自動決済（pips）</div>

            <label style={{ marginRight: '16px' }}>
              利確
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={tpPipsInput}
                onChange={(e) =>
                  setTpPipsInput(e.target.value.replace(/[^0-9]/g, ''))
                }
                placeholder="例: 30"
                style={{
                  width: '60px',
                  marginLeft: '6px',
                  textAlign: 'right',
                }}
              />
              pips
            </label>

            <label>
              損切り
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9-]*"
                value={slPipsInput}
                onChange={(e) =>
                  setSlPipsInput(
                    e.target.value
                      // 数字とマイナス以外を削除
                      .replace(/[^0-9-]/g, '')
                      // 先頭以外の「-」は消す（--20 や 2-0 を防止）
                      .replace(/(?!^)-/g, '')
                  )
                }
                placeholder="例: 20"
                style={{
                  width: '60px',
                  marginLeft: '6px',
                  textAlign: 'right',
                }}
              />
              pips
            </label>
          </div>

          {/* スピード系（下側に集約） */}
          <div style={{ marginBottom: '8px', fontSize: '13px' }}>
            再生スピード:{' '}
            <button onClick={() => setPlaySpeed(2000)}>🐢 ゆっくり</button>{' '}
            <button onClick={() => setPlaySpeed(1000)}>▶ 普通</button>{' '}
            <button onClick={() => setPlaySpeed(400)}>⏩ 速い</button>{' '}
            <span style={{ marginLeft: '8px', color: '#555' }}>
              （現在: {playSpeed} ms / 本）
            </span>
          </div>

          {/* スライダーでスピード調整 */}
          <div style={{ marginBottom: '16px' }}>
            <input
              type="range"
              min={200} // 最速 0.2秒 / 本
              max={4000} // 最遅 4秒 / 本
              step={100}
              value={playSpeed}
              onChange={(e) => setPlaySpeed(Number(e.target.value))}
              style={{ width: '100%' }}
            />
            <div
              style={{
                fontSize: '12px',
                color: '#555',
                marginTop: '4px',
              }}
            >
              スライダー速度: {playSpeed} ms / 本
            </div>
          </div>

          {/* 現在の足情報 */}
          {currentCandle && (
            <div
              style={{
                padding: '10px',
                border: '1px solid '#ddd',
                borderRadius: '4px',
                fontSize: '14px',
                background: '#fafafa',
              }}
            >
              <div>
                <strong>時間:</strong> {currentCandle.time}
              </div>
              <div>
                <strong>始値:</strong> {currentCandle.open}
              </div>
              <div>
                <strong>高値:</strong> {currentCandle.high}
              </div>
              <div>
                <strong>安値:</strong> {currentCandle.low}
              </div>
              <div>
                <strong>終値:</strong> {currentCandle.close}
              </div>
              <div>
                <strong>出来高:</strong> {currentCandle.volume}
              </div>
            </div>
          )}
        </section>
      )}

      {/* トレードパネル */}
      {candles.length > 0 && (
        <section style={{ marginTop: '10px' }}>
          {/* 現在のポジション */}
          <div
            style={{
              padding: '10px',
              border: '1px solid '#ddd',
              borderRadius: '4px',
              marginBottom: '10px',
              background: '#fdfdfd',
              fontSize: '14px',
            }}
          >
            <strong>現在のポジション:</strong>{' '}
            {position ? (
              <>
                {position.side === 'buy' ? '買い（ロング）' : '売り（ショート）'} @{' '}
                {position.entryPrice}
                <br />
                建玉時間: {position.entryTime}
                <br />
                含み損益:{' '}
                {unrealizedPips !== null
                  ? unrealizedPips.toFixed(1) + ' pips'
                  : '-'}
              </>
            ) : (
              'なし'
            )}
          </div>

          {/* 統計 */}
          <div
            style={{
              padding: '10px',
              border: '1px solid '#ddd',
              borderRadius: '4px',
              marginBottom: '16px',
              background: '#fafafa',
              fontSize: '14px',
            }}
          >
            <strong>成績サマリー</strong>
            <div>トレード数: {stats.totalTrades}</div>
            <div>勝率: {stats.winRate}%</div>
            <div>平均獲得pips: {stats.avgPips}</div>
            <div>合計pips: {stats.totalPips}</div>
          </div>

          {/* トレード履歴 */}
          {trades.length > 0 && (
            <div>
              <h3>トレード履歴</h3>
              <div
                style={{
                  overflowX: 'auto',
                  maxHeight: '260px',
                  border: '1px solid '#ddd',
                }}
              >
                <table
                  style={{
                    borderCollapse: 'collapse',
                    width: '100%',
                    fontSize: '12px',
                  }}
                >
                  <thead>
                    <tr>
                      <th
                        style={{
                          border: '1px solid '#ddd',
                          padding: '4px 6px',
                          background: '#f7f7f7',
                        }}
                      >
                        #
                      </th>
                      <th
                        style={{
                          border: '1px solid '#ddd',
                          padding: '4px 6px',
                          background: '#f7f7f7',
                        }}
                      >
                        売買
                      </th>
                      <th
                        style={{
                          border: '1px solid '#ddd',
                          padding: '4px 6px',
                          background: '#f7f7f7',
                        }}
                      >
                        エントリー時間
                      </th>
                      <th
                        style={{
                          border: '1px solid '#ddd',
                          padding: '4px 6px',
                          background: '#f7f7f7',
                        }}
                      >
                        エントリー価格
                      </th>
                      <th
                        style={{
                          border: '1px solid '#ddd',
                          padding: '4px 6px',
                          background: '#f7f7f7',
                        }}
                      >
                        決済時間
                      </th>
                      <th
                        style={{
                          border: '1px solid '#ddd',
                          padding: '4px 6px',
                          background: '#f7f7f7',
                        }}
                      >
                        決済価格
                      </th>
                      <th
                        style={{
                          border: '1px solid '#ddd',
                          padding: '4px 6px',
                          background: '#f7f7f7',
                        }}
                      >
                        pips
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map((t, i) => (
                      <tr key={i}>
                        <td
                          style={{
                            border: '1px solid #eee',
                            padding: '3px 6px',
                          }}
                        >
                          {i + 1}
                        </td>
                        <td
                          style={{
                            border: '1px solid '#eee',
                            padding: '3px 6px',
                          }}
                        >
                          {t.side === 'buy' ? 'Buy' : 'Sell'}
                        </td>
                        <td
                          style={{
                            border: '1px solid '#eee',
                            padding: '3px 6px',
                          }}
                        >
                          {t.entryTime}
                        </td>
                        <td
                          style={{
                            border: '1px solid '#eee',
                            padding: '3px 6px',
                          }}
                        >
                          {t.entryPrice}
                        </td>
                        <td
                          style={{
                            border: '1px solid '#eee',
                            padding: '3px 6px',
                          }}
                        >
                          {t.exitTime}
                        </td>
                        <td
                          style={{
                            border: '1px solid '#eee',
                            padding: '3px 6px',
                          }}
                        >
                          {t.exitPrice}
                        </td>
                        <td
                          style={{
                            border: '1px solid '#eee',
                            padding: '3px 6px',
                          }}
                        >
                          {t.pips.toFixed(1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 累積pipsの推移（エクイティカーブ） */}
          {equityChart && (
            <div style={{ marginTop: '16px', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '14px', margin: '4px 0' }}>累積pips 推移</h3>
              <svg
                width="100%"
                viewBox={`0 0 ${equityChart.width} ${equityChart.height}`}
                style={{
                  border: '1px solid '#eee',
                  background: '#ffffff',
                }}
              >
                {/* 0ライン */}
                {equityChart.zeroY !== null && (
                  <line
                    x1={equityChart.paddingX}
                    y1={equityChart.zeroY}
                    x2={equityChart.width - equityChart.paddingX}
                    y2={equityChart.zeroY}
                    stroke="#ddd"
                    strokeWidth={1}
                  />
                )}

                {/* エクイティライン */}
                <path
                  d={equityChart.points
                    .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
                    .join(' ')}
                  stroke="#1976d2"
                  strokeWidth={2}
                  fill="none"
                />
              </svg>
              <div
                style={{
                  fontSize: '12px',
                  color: '#555',
                  marginTop: '4px',
                }}
              >
                累積pips 最小: {equityChart.min.toFixed(1)} / 最大:{' '}
                {equityChart.max.toFixed(1)}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export default App;
