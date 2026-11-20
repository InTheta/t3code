import type { Flow, FlowEdge, FlowNode, FlowStatus } from "~/lib/runFlow";

const WIDTH = 132;
const HEIGHT = 54;
const COLUMN = 158;
const ROW = 92;
const PAD = 14;

const statusStroke: Record<FlowStatus, string> = {
  done: "stroke-success",
  active: "stroke-info",
  waiting: "stroke-warning",
  blocked: "stroke-warning",
  failed: "stroke-destructive",
  pending: "stroke-border",
};
const statusGlyph: Record<FlowStatus, string> = {
  done: "✓",
  active: "●",
  waiting: "!",
  blocked: "■",
  failed: "✕",
  pending: "○",
};
const statusWord: Record<FlowStatus, string> = {
  done: "done",
  active: "in progress",
  waiting: "waiting for you",
  blocked: "blocked",
  failed: "failed",
  pending: "not reached",
};

function shorten(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

const reach = (node: FlowNode) => (node.kind === "decision" ? { x: 6, y: 4 } : { x: 0, y: 0 });

function centre(node: FlowNode) {
  return { x: PAD + node.col * COLUMN + WIDTH / 2, y: PAD + node.row * ROW + HEIGHT / 2 };
}

type Point = { x: number; y: number };
const side = {
  right: (c: Point, n: FlowNode) => ({ x: c.x + WIDTH / 2 + reach(n).x, y: c.y }),
  left: (c: Point, n: FlowNode) => ({ x: c.x - WIDTH / 2 - reach(n).x, y: c.y }),
  top: (c: Point, n: FlowNode) => ({ x: c.x, y: c.y - HEIGHT / 2 - reach(n).y }),
  bottom: (c: Point, n: FlowNode) => ({ x: c.x, y: c.y + HEIGHT / 2 + reach(n).y }),
};

/** Path and label position for one edge. Opposite edges between the same two nodes run side by side. */
function route(edge: FlowEdge, from: FlowNode, to: FlowNode, hasOpposite: boolean) {
  const a = centre(from);
  const b = centre(to);
  const dx = to.col - from.col;
  const dy = to.row - from.row;
  const shift = hasOpposite ? (edge.taken || from.row < to.row ? -14 : 14) : 0;
  let start: Point;
  let end: Point;
  if (dy === 0) {
    start = dx > 0 ? side.right(a, from) : side.left(a, from);
    end = dx > 0 ? side.left(b, to) : side.right(b, to);
    return {
      d: `M${start.x},${start.y + shift} L${end.x},${end.y + shift}`,
      label: { x: (start.x + end.x) / 2, y: start.y + shift - 6 },
    };
  }
  if (dx === 0) {
    start = dy > 0 ? side.bottom(a, from) : side.top(a, from);
    end = dy > 0 ? side.top(b, to) : side.bottom(b, to);
    return {
      d: `M${start.x + shift},${start.y} L${end.x + shift},${end.y}`,
      label: { x: start.x + shift + 6, y: (start.y + end.y) / 2 },
    };
  }
  start = dx > 0 ? side.right(a, from) : side.left(a, from);
  end = dy > 0 ? side.top(b, to) : side.bottom(b, to);
  if (dx < 0) end = { x: end.x + 34, y: end.y };
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  return {
    d: `M${start.x},${start.y} C${end.x},${start.y} ${end.x},${start.y} ${end.x},${end.y}`,
    label: mid,
  };
}

export function FlowDiagram({
  flow,
  label,
  selectedId,
  onSelect,
}: {
  flow: Flow;
  label: string;
  selectedId?: string | undefined;
  onSelect?: ((node: FlowNode) => void) | undefined;
}) {
  const byId = new Map(flow.nodes.map((node) => [node.id, node]));
  const columns = Math.max(0, ...flow.nodes.map((node) => node.col)) + 1;
  const rows = Math.max(0, ...flow.nodes.map((node) => node.row)) + 1;
  const width = PAD * 2 + (columns - 1) * COLUMN + WIDTH;
  const height = PAD * 2 + (rows - 1) * ROW + HEIGHT;
  return (
    <div className="mt-3 overflow-x-auto rounded-md border bg-muted/20 p-2">
      <svg
        role="group"
        aria-label={label}
        viewBox={`0 0 ${width} ${height}`}
        style={{
          width: "100%",
          minWidth: Math.round(width * 0.75),
          maxWidth: width,
          height: "auto",
        }}
        className="text-foreground"
      >
        <defs>
          <marker
            id="flow-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="context-stroke" />
          </marker>
        </defs>
        {flow.edges.map((edge) => {
          const from = byId.get(edge.from);
          const to = byId.get(edge.to);
          if (!from || !to) return null;
          const hasOpposite = flow.edges.some(
            (other) => other.from === edge.to && other.to === edge.from,
          );
          const { d, label: at } = route(edge, from, to, hasOpposite);
          return (
            <g
              key={`${edge.from}>${edge.to}`}
              data-edge={`${edge.from}>${edge.to}`}
              data-taken={edge.taken}
            >
              <path
                d={d}
                fill="none"
                strokeWidth={1.5}
                strokeDasharray={edge.taken ? undefined : "5 4"}
                className={edge.taken ? "stroke-foreground/70" : "stroke-muted-foreground/50"}
                markerEnd="url(#flow-arrow)"
              />
              {edge.label && (
                <text
                  x={at.x}
                  y={at.y}
                  fontSize={10}
                  textAnchor="middle"
                  className="fill-muted-foreground"
                >
                  {edge.label}
                </text>
              )}
            </g>
          );
        })}
        {flow.nodes.map((node) => {
          const x = PAD + node.col * COLUMN;
          const y = PAD + node.row * ROW;
          const selectable = onSelect !== undefined && node.stageId !== undefined;
          const selected = selectedId !== undefined && selectedId === node.id;
          const text = `${node.label}, ${statusWord[node.status]}${node.sub ? `, ${node.sub}` : ""}`;
          return (
            <g
              key={node.id}
              data-node={node.id}
              data-status={node.status}
              role={selectable ? "button" : "img"}
              aria-label={text}
              aria-pressed={selectable ? selected : undefined}
              tabIndex={selectable ? 0 : undefined}
              className={
                selectable
                  ? "cursor-pointer focus-visible:outline-2 focus-visible:outline-ring"
                  : undefined
              }
              onClick={selectable ? () => onSelect(node) : undefined}
              onKeyDown={
                selectable
                  ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelect(node);
                      }
                    }
                  : undefined
              }
            >
              {node.kind === "decision" ? (
                <polygon
                  points={`${x + WIDTH / 2},${y - 4} ${x + WIDTH + 6},${y + HEIGHT / 2} ${x + WIDTH / 2},${y + HEIGHT + 4} ${x - 6},${y + HEIGHT / 2}`}
                  strokeWidth={selected ? 3 : 1.75}
                  className={`fill-card ${statusStroke[node.status]}`}
                />
              ) : (
                <rect
                  x={x}
                  y={y}
                  width={WIDTH}
                  height={HEIGHT}
                  rx={8}
                  strokeWidth={selected ? 3 : 1.75}
                  className={`fill-card ${statusStroke[node.status]}`}
                />
              )}
              <title>{text}</title>
              <text
                x={x + WIDTH / 2}
                y={y + (node.sub ? 22 : 31)}
                fontSize={12}
                fontWeight={600}
                textAnchor="middle"
                className="fill-foreground"
              >
                {shorten(node.label, node.kind === "decision" ? 16 : 19)}
              </text>
              {node.sub && (
                <text
                  x={x + WIDTH / 2}
                  y={y + 39}
                  fontSize={10}
                  textAnchor="middle"
                  className="fill-muted-foreground"
                >
                  {shorten(node.sub, node.kind === "decision" ? 20 : 25)}
                </text>
              )}
              {node.kind === "step" && (
                <text
                  x={x + WIDTH - 9}
                  y={y + 15}
                  fontSize={11}
                  textAnchor="middle"
                  className={`fill-foreground`}
                >
                  {statusGlyph[node.status]}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
