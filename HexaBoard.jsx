import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * HexaBoard – 8.000 editierbare Waben
 * A compact React component using canvas to render 8,000 hex cells.
 */

// ==== Raster-Konfiguration ====
const COLS = 100; // 100 * 80 = 8.000
const ROWS = 80;
const RADIUS = 14; // Pixel-Radius der Hexe (Render-Größe).

// Zeichenstil
const STROKE = 1;
const DEFAULT_FILL = "#f3f4f6"; // Tailwind gray-100
const HOVER_STROKE = "#111827"; // gray-900
const SELECTED_STROKE = "#2563eb"; // blue-600

const MAX_LABEL_CHARS = 18;

// SHA-256 helper
async function sha256Hex(input) {
  const enc = new TextEncoder();
  const data = enc.encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// LocalStorage adapter
const LS_KEY_PREFIX = "hexaboard_cell_";

const LocalStorageAdapter = {
  async getCell(index) {
    const raw = localStorage.getItem(LS_KEY_PREFIX + index);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },
  async setCell(index, data) {
    localStorage.setItem(LS_KEY_PREFIX + index, JSON.stringify(data));
  },
};

function useStorage() {
  const [adapter, setAdapter] = useState(null);
  useEffect(() => {
    setAdapter(LocalStorageAdapter);
  }, []);
  return adapter;
}

// Geometry
function hexCorner(centerX, centerY, radius, i) {
  const angleDeg = 60 * i - 30;
  const angle = (Math.PI / 180) * angleDeg;
  return [centerX + radius * Math.cos(angle), centerY + radius * Math.sin(angle)];
}

function buildHexPath(ctx, cx, cy, r) {
  const [x0, y0] = hexCorner(cx, cy, r, 0);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  for (let i = 1; i < 6; i++) {
    const [x, y] = hexCorner(cx, cy, r, i);
    ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function computeHexCenters(cols, rows, r) {
  const w = r * Math.sqrt(3);
  const h = r * 1.5;
  const centers = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * w * 2 + (row % 2 ? w : 0) + w;
      const y = row * h + r + 2;
      centers.push({ x, y, row, col, index: row * cols + col });
    }
  }
  return { centers, totalWidth: cols * w * 2 + w, totalHeight: rows * (r * 1.5) + r + 4 };
}

// Main component
export default function HexaBoard() {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const storage = useStorage();

  const { centers, totalWidth, totalHeight } = useMemo(
    () => computeHexCenters(COLS, ROWS, RADIUS),
    []
  );

  const [cells, setCells] = useState(() => new Map());
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const lastPos = useRef({ x: 0, y: 0 });

  const [hoverIndex, setHoverIndex] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(null);

  const [codeInput, setCodeInput] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [colorInput, setColorInput] = useState("#fde68a");
  const [message, setMessage] = useState("");
  const [adapterName, setAdapterName] = useState("LocalStorage");

  useEffect(() => {
    if (!storage) return;
    const name = "LocalStorage";
    setAdapterName(name);
  }, [storage]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const resize = () => {
      if (!canvas || !container) return;
      const dpr = window.devicePixelRatio || 1;
      const { clientWidth, clientHeight } = container;
      canvas.width = clientWidth * dpr;
      canvas.height = clientHeight * dpr;
      canvas.style.width = clientWidth + "px";
      canvas.style.height = clientHeight + "px";
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, offset, hoverIndex, selectedIndex, cells, storage]);

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(offset.x, offset.y);
    ctx.scale(scale, scale);

    for (let i = 0; i < centers.length; i++) {
      const c = centers[i];
      const cell = cells.get(c.index);
      const fill = cell?.color || DEFAULT_FILL;
      buildHexPath(ctx, c.x, c.y, RADIUS);
      ctx.lineWidth = STROKE;
      ctx.fillStyle = fill;

      if (selectedIndex === c.index) {
        ctx.strokeStyle = SELECTED_STROKE;
        ctx.lineWidth = 2;
      } else if (hoverIndex === c.index) {
        ctx.strokeStyle = HOVER_STROKE;
      } else {
        ctx.strokeStyle = "#d1d5db";
      }

      ctx.fill();
      ctx.stroke();

      if (cell?.label) {
        ctx.save();
        ctx.fillStyle = "#111827";
        ctx.font = "500 10px system-ui, -apple-system, Segoe UI, Roboto";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const maxWidth = RADIUS * 1.6;
        const text = cell.label;
        const truncated = text.length > 10 ? text.slice(0, 10) + "…" : text;
        ctx.fillText(truncated, c.x, c.y, maxWidth);
        ctx.restore();
      }
    }

    ctx.restore();
  }

  function pickIndex(canvasX, canvasY) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = (canvasX - rect.left - offset.x) / scale;
    const y = (canvasY - rect.top - offset.y) / scale;

    const ctx = canvas.getContext("2d");
    for (let i = 0; i < centers.length; i++) {
      const c = centers[i];
      buildHexPath(ctx, c.x, c.y, RADIUS);
      if (ctx.isPointInPath(x, y)) return c.index;
    }
    return null;
  }

  async function ensureCellLoaded(index) {
    if (!storage) return;
    if (cells.has(index)) return;
    const data = await storage.getCell(index);
    if (data) {
      setCells((prev) => new Map(prev).set(index, data));
    }
  }

  function onWheel(e) {
    e.preventDefault();
    const delta = -e.deltaY;
    const factor = Math.exp(delta * 0.001);
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const newScale = Math.max(0.3, Math.min(3, scale * factor));
    const worldX = (mx - offset.x) / scale;
    const worldY = (my - offset.y) / scale;
    const newOffsetX = mx - worldX * newScale;
    const newOffsetY = my - worldY * newScale;

    setScale(newScale);
    setOffset({ x: newOffsetX, y: newOffsetY });
  }

  function onMouseDown(e) {
    if (e.button === 0) {
      const idx = pickIndex(e.clientX, e.clientY);
      setSelectedIndex(idx);
      setHoverIndex(idx);
      if (idx != null) ensureCellLoaded(idx);
    }
    if (e.button === 1 || e.button === 2) {
      setDragging(true);
      lastPos.current = { x: e.clientX, y: e.clientY };
    }
  }

  function onMouseMove(e) {
    if (dragging) {
      const dx = e.clientX - lastPos.current.x;
      const dy = e.clientY - lastPos.current.y;
      lastPos.current = { x: e.clientX, y: e.clientY };
      setOffset((o) => ({ x: o.x + dx, y: o.y + dy }));
      return;
    }
    const idx = pickIndex(e.clientX, e.clientY);
    setHoverIndex(idx);
    if (idx != null) ensureCellLoaded(idx);
  }

  function onMouseUp() {
    setDragging(false);
  }

  function onContextMenu(e) {
    e.preventDefault();
  }

  const selectedCell = selectedIndex != null ? cells.get(selectedIndex) : null;
  const claimed = !!selectedCell?.codeHash;

  async function handleSave() {
    if (selectedIndex == null || !storage) return;
    setMessage("");

    const existing = selectedCell || (await storage.getCell(selectedIndex)) || {};

    if (existing.codeHash) {
      if (!codeInput) return setMessage("Bitte Code eingeben.");
      const inputHash = await sha256Hex(codeInput.trim());
      if (inputHash !== existing.codeHash) return setMessage("Falscher Code.");
    } else {
      if (!codeInput || codeInput.trim().length < 4)
        return setMessage("Bitte neuen Code (min. 4 Zeichen) setzen.");
      existing.codeHash = await sha256Hex(codeInput.trim());
    }

    const cleanLabel = (labelInput || existing.label || "").slice(0, MAX_LABEL_CHARS);
    const payload = {
      color: colorInput || existing.color || DEFAULT_FILL,
      label: cleanLabel,
      codeHash: existing.codeHash,
    };

    await storage.setCell(selectedIndex, payload);
    setCells((prev) => new Map(prev).set(selectedIndex, payload));
    setMessage("Gespeichert ✅");
  }

  function handleClearLabel() {
    setLabelInput("");
  }

  useEffect(() => {
    setMessage("");
    if (selectedIndex == null) return;
    const cell = cells.get(selectedIndex);
    setLabelInput(cell?.label || "");
    setColorInput(cell?.color || "#fde68a");
    setCodeInput("");
  }, [selectedIndex, cells]);

  const infoText = useMemo(() => {
    const cols = COLS.toLocaleString();
    const rows = ROWS.toLocaleString();
    return `${cols} × ${rows} Waben | Adapter: ${adapterName}`;
  }, [adapterName]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const pad = 24;
    const scaleX = (container.clientWidth - pad * 2) / totalWidth;
    const scaleY = (container.clientHeight - pad * 2) / totalHeight;
    const s = Math.min(scaleX, scaleY, 1.2);
    setScale(s);
    setOffset({ x: pad, y: pad });
  }, [totalWidth, totalHeight]);

  return (
    <div className="w-screen h-screen grid grid-cols-12 bg-white text-gray-900">
      <div
        ref={containerRef}
        className="col-span-8 lg:col-span-9 relative overflow-hidden border-r border-gray-200"
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onContextMenu={onContextMenu}
      >
        <canvas ref={canvasRef} className="block w-full h-full cursor-crosshair select-none" />

        <div className="absolute top-3 left-3 flex items-center gap-2 bg-white/80 backdrop-blur rounded-2xl shadow px-3 py-2 text-sm">
          <span className="font-medium">HexaBoard</span>
          <span className="text-gray-500">Zoom: {(scale * 100).toFixed(0)}%</span>
          <span className="text-gray-500">{infoText}</span>
        </div>

        <div className="absolute bottom-3 left-3 max-w-[28rem] text-xs bg-white/80 backdrop-blur rounded-2xl shadow px-3 py-2 leading-relaxed">
          <p className="mb-1 font-medium">Steuerung</p>
          <p>• Linksklick: Wabe auswählen · • Mausrad/Pinch: Zoomen · • Rechtsklick/Scrollrad: Verschieben</p>
        </div>
      </div>

      <div className="col-span-4 lg:col-span-3 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <h1 className="text-xl font-semibold">Editor</h1>
          <p className="text-sm text-gray-600">Wabe auswählen, Code eingeben, ändern & speichern.</p>
        </div>

        <div className="p-4 flex-1 overflow-auto">
          {selectedIndex == null ? (
            <div className="text-gray-600 text-sm">Keine Wabe ausgewählt.</div>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="text-sm text-gray-500">Index</div>
                <div className="font-mono">{selectedIndex}</div>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Code</label>
                <input
                  type="password"
                  className="w-full border rounded-xl px-3 py-2 text-sm"
                  placeholder={claimed ? "Code zum Bearbeiten eingeben" : "Neuen Code setzen (min. 4 Zeichen)"}
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value)}
                />
                <p className="text-xs text-gray-500">
                  {claimed
                    ? "Diese Wabe ist bereits belegt. Zum Ändern bitte den Code eingeben."
                    : "Noch frei: Lege jetzt einen Code fest und sichere dir diese Wabe."}
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Beschriftung</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="flex-1 border rounded-xl px-3 py-2 text-sm"
                    placeholder="max. 18 Zeichen"
                    maxLength={MAX_LABEL_CHARS}
                    value={labelInput}
                    onChange={(e) => setLabelInput(e.target.value)}
                  />
                  <button
                    className="px-3 py-2 text-sm rounded-xl border hover:bg-gray-50"
                    onClick={handleClearLabel}
                  >
                    Löschen
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Farbe</label>
                <input
                  type="color"
                  className="w-24 h-10 border rounded-xl"
                  value={colorInput}
                  onChange={(e) => setColorInput(e.target.value)}
                />
              </div>

              <div className="pt-2">
                <button
                  onClick={handleSave}
                  className="w-full bg-blue-600 text-white rounded-2xl py-2.5 text-sm font-medium shadow hover:bg-blue-700"
                >
                  Speichern
                </button>
                {message && <div className="mt-2 text-sm text-gray-700">{message}</div>}
              </div>

              <div className="text-xs text-gray-500 pt-4 border-t">
                <p className="font-medium mb-1">Persistenz</p>
                <ul className="list-disc ml-4 space-y-1">
                  <li>
                    Aktuell: <span className="font-medium">{adapterName}</span>.
                    Ohne Konfiguration wird im Browser gespeichert (nur für dich sichtbar).
                  </li>
                </ul>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t text-xs text-gray-500">
          <p>
            Tipp: Auf GitHub Pages/Netlify kostenlos deployen. Dieses Single-File-React-Component funktioniert in
            modernen Bundlern (Vite, Next.js/CSR, CRA). Tailwind wird durch CDN bereitgestellt.
          </p>
        </div>
      </div>
    </div>
  );
}
