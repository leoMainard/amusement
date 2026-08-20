/**
 * Port TypeScript de `borders.py` (mêmes hypothèses, voir docs/plan.md) :
 * traduit les libellés du livret (nombres/lettres) en points d'entrée
 * pour l'aperçu local (Phase 3). À garder synchronisé avec `borders.py`
 * si l'hypothèse de répartition change.
 */

import { type BoardDimensions, DEFAULT_DIMENSIONS, type Direction, type Position } from "./types";

export interface Entry {
  position: Position;
  direction: Direction;
}

export class LabelScheme {
  private labelToEntry = new Map<string, Entry>();
  private entryToLabel = new Map<string, string>();

  constructor(dimensions: BoardDimensions = DEFAULT_DIMENSIONS) {
    const { width, height } = dimensions;

    for (let col = 0; col < width; col++) {
      this.add(String(col + 1), { position: [col, -1], direction: "DOWN" });
    }
    for (let col = 0; col < width; col++) {
      this.add(String(width + col + 1), { position: [col, height], direction: "UP" });
    }
    for (let row = 0; row < height; row++) {
      this.add(letter(row), { position: [-1, row], direction: "RIGHT" });
    }
    for (let row = 0; row < height; row++) {
      this.add(letter(height + row), { position: [width, row], direction: "LEFT" });
    }
  }

  private add(label: string, entry: Entry): void {
    this.labelToEntry.set(label, entry);
    this.entryToLabel.set(entryKey(entry), label);
  }

  entryForLabel(label: string): Entry {
    const entry = this.labelToEntry.get(label);
    if (!entry) throw new Error(`Libellé de point d'entrée inconnu : ${label}`);
    return entry;
  }

  labelForEntry(entry: Entry): string {
    const label = this.entryToLabel.get(entryKey(entry));
    if (!label) throw new Error(`Aucun libellé ne correspond à ${JSON.stringify(entry)}`);
    return label;
  }

  allEntries(): Array<{ label: string; entry: Entry }> {
    return [...this.labelToEntry.entries()].map(([label, entry]) => ({ label, entry }));
  }
}

function entryKey(entry: Entry): string {
  return `${entry.position[0]},${entry.position[1]},${entry.direction}`;
}

function letter(index: number): string {
  if (index < 0 || index >= 26) throw new Error("Plateau trop grand pour un étiquetage A-Z simple.");
  return String.fromCharCode("A".charCodeAt(0) + index);
}
