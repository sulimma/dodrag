// Actions on a selected item address its selection; a drop outside it addresses just that item.
export function selectionActionIds(id: string, selected: readonly string[]): string[] {
  return selected.includes(id) ? [...selected] : [id];
}
