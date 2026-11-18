/** The key names are unique by: case and runs of spaces don't count ("fran" is "Fran"). */
export function benchmarkNameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** By name as people read it, whatever the database's collation ("Diane" before "DT"). */
export function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
}
