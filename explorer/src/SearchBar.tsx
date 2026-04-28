import { useEffect, useRef, useState } from "react";
import { fetchSearch } from "./api";
import type { SearchHit } from "./types";

interface Props {
  onPick: (id: string) => void;
}

/**
 * Search bar with debounced server-side fuzzy search. Hits dropdown shows
 * top results; Enter or click selects the first/highlighted result and
 * delegates to `onPick(id)` so the parent can focus the camera.
 */
export function SearchBar({ onPick }: Props) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    if (q.trim().length === 0) {
      setHits([]);
      return;
    }
    debounceRef.current = window.setTimeout(() => {
      fetchSearch(q, undefined, 12)
        .then((r) => {
          setHits(r.hits);
          setHighlight(0);
        })
        .catch(() => setHits([]));
    }, 120);
    return () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    };
  }, [q]);

  function pick(hit: SearchHit) {
    onPick(hit.id);
    setOpen(false);
    setQ(hit.label);
  }

  return (
    <div className="searchbar">
      <input
        className="searchbar-input"
        type="text"
        placeholder="Search nodes…   (try a feature name or id)"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, hits.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter" && hits[highlight]) {
            pick(hits[highlight]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && hits.length > 0 ? (
        <ul className="searchbar-results" role="listbox">
          {hits.map((h, i) => (
            <li
              key={h.id}
              className={`searchbar-hit${i === highlight ? " active" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(h);
              }}
              onMouseEnter={() => setHighlight(i)}
            >
              <span className={`searchbar-type t-${h.type}`}>{h.type}</span>
              <span className="searchbar-label">{h.label}</span>
              <span className="searchbar-score">{h.score.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
