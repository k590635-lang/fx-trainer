const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 4001;

/* ========================
   ▼ 全ユーザー共有のローソク足データ（メモリ上）
   ======================== */
let sharedCandles = [];
let sharedUploadInfo = null;

/* ========================
   アップロード設定
   ======================== */
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
const upload = multer({ dest: UPLOAD_DIR });

/* ========================
   CORS
   ======================== */
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(cors());
app.use(express.json());

/* ========================
   ヘルスチェック
   ======================== */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

/* ========================
   CSV アップロード（管理者のみ利用）
   ======================== */
app.post('/api/upload-csv', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'ファイルがありません' });
  }

  const filePath = req.file.path;

  fs.readFile(filePath, 'utf8', (err, content) => {
    if (err) {
      console.error('CSV読み込みエラー:', err);
      return res.status(500).json({ success: false, message: '読み込み失敗' });
    }

    const rawLines = content.split(/\r?\n/);
    const lines = rawLines.filter((l) => l.trim() !== '');
    if (lines.length === 0) {
      return res.json({ success: false, message: 'CSVが空です' });
    }

    // 区切り推定
    let delimiter = ',';
    if (lines[0].includes(';')) delimiter = ';';
    if (lines[0].includes('\t')) delimiter = '\t';

    const header = lines[0].split(delimiter).map((h) => h.trim());
    const totalRows = Math.max(lines.length - 1, 0);
    let dataLines = lines.slice(1);

    // 最大本数制限
    const MAX_CANDLES = 20000;
    if (dataLines.length > MAX_CANDLES) {
      dataLines = dataLines.slice(-MAX_CANDLES);
    }

    const preview = dataLines.slice(0, 20).map((line) =>
      line.split(delimiter).map((cell) => cell.trim())
    );

    const lowerHeader = header.map((h) => h.toLowerCase());
    const idxDate = lowerHeader.indexOf('date');
    const idxTime = lowerHeader.indexOf('time');
    const idxOpen = lowerHeader.indexOf('open');
    const idxHigh = lowerHeader.indexOf('high');
    const idxLow = lowerHeader.indexOf('low');
    const idxClose = lowerHeader.indexOf('close');
    const idxVolume = lowerHeader.indexOf('volume');

    const uploadedCandles = dataLines
      .map((line) => {
        const cells = line.split(delimiter).map((c) => c.trim());
        if (!cells.length) return null;

        const dateStr = idxDate >= 0 ? cells[idxDate] : '';
        const timeStr = idxTime >= 0 ? cells[idxTime] : '';

        let timestamp = null;
        let label = '';

        if (dateStr) {
          const [y, m, d] = dateStr.split('.').map(Number);
          let h = 0;
          let min = 0;
          if (timeStr) {
            const parts = timeStr.split(':');
            h = Number(parts[0]) || 0;
            min = Number(parts[1]) || 0;
          }
          const dt = new Date(y, (m || 1) - 1, d || 1, h, min);
          timestamp = dt.getTime();
          label = `${dateStr} ${timeStr}`;
        }

        const open = idxOpen >= 0 ? Number(cells[idxOpen]) : NaN;
        const high = idxHigh >= 0 ? Number(cells[idxHigh]) : NaN;
        const low = idxLow >= 0 ? Number(cells[idxLow]) : NaN;
        const close = idxClose >= 0 ? Number(cells[idxClose]) : NaN;
        const volume = idxVolume >= 0 ? Number(cells[idxVolume]) : 0;

        if (
          Number.isNaN(open) ||
          Number.isNaN(high) ||
          Number.isNaN(low) ||
          Number.isNaN(close)
        ) {
          return null;
        }

        return { time: label, timestamp, open, high, low, close, volume };
      })
      .filter(Boolean);

    console.log('CSV 読み込み完了（実際に使う本数）:', uploadedCandles.length);

    // ▼ 全ユーザー共有データとして保存
    sharedCandles = uploadedCandles;
    sharedUploadInfo = { header, totalRows, preview, delimiter };

    // アップロード結果を返す（フロント管理画面向け）
    res.json({
      success: true,
      header,
      totalRows,
      preview,
      delimiter,
      candles: uploadedCandles,
    });
  });
});

/* ========================
   ▼ 共有データ取得（全ユーザー共通）
   ======================== */
app.get('/api/default-candles', (req, res) => {
  if (!sharedCandles || sharedCandles.length === 0) {
    return res.json({
      success: false,
      message: '共通データがまだ登録されていません。',
    });
  }

  res.json({
    success: true,
    candles: sharedCandles,
    uploadInfo: sharedUploadInfo,
  });
});

// おまけ：/api/shared-candles でも同じものを返したい場合
app.get('/api/shared-candles', (req, res) => {
  res.json({
    success: true,
    candles: sharedCandles,
  });
});

/* ========================
   サーバー起動
   ======================== */
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
