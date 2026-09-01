export interface FlatCategory {
  id: string;
  code: string;
  name: string;
  parentCategoryId: string | null;
  isActive: boolean;
}

export interface CategoryTreeNode extends FlatCategory {
  children: CategoryTreeNode[];
  depth: number;
}

/** Builds a nested tree from a flat list — O(n), no recursive query needed at the scale a company's category list ever reaches. */
export function buildCategoryTree(flat: FlatCategory[]): CategoryTreeNode[] {
  const byId = new Map<string, CategoryTreeNode>();
  flat.forEach((c) => byId.set(c.id, { ...c, children: [], depth: 0 }));

  const roots: CategoryTreeNode[] = [];
  byId.forEach((node) => {
    const parent = node.parentCategoryId ? byId.get(node.parentCategoryId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  });

  function assignDepth(nodes: CategoryTreeNode[], depth: number) {
    for (const n of nodes) {
      n.depth = depth;
      assignDepth(n.children, depth + 1);
    }
  }
  assignDepth(roots, 0);

  function sortTree(nodes: CategoryTreeNode[]) {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    nodes.forEach((n) => sortTree(n.children));
  }
  sortTree(roots);

  return roots;
}

export interface CategoryOption {
  id: string;
  label: string;
}

/**
 * Flattens the tree into an indented option list for a plain `<select>` —
 * used by both the category manager's own "Parent Category" picker and
 * ProductForm's Category picker. When `excludeSubtreeOf` is given, that
 * category and everything under it is omitted entirely, so a category can
 * never be re-parented under one of its own descendants (mirrors the
 * server-side cycle guard in `createCategory`/`updateCategory`).
 */
export function buildCategoryOptions(flat: FlatCategory[], excludeSubtreeOf?: string): CategoryOption[] {
  const tree = buildCategoryTree(flat);
  const options: CategoryOption[] = [];

  function walk(nodes: CategoryTreeNode[]) {
    for (const node of nodes) {
      if (node.id === excludeSubtreeOf) continue; // skips this node AND its subtree (no walk(node.children) call)
      options.push({ id: node.id, label: `${"— ".repeat(node.depth)}${node.name}` });
      walk(node.children);
    }
  }
  walk(tree);

  return options;
}

/** Full ancestor path for breadcrumb display, root-first (e.g. ["Trousers", "Denim", "Skinny Fit"]). */
export function getCategoryAncestorPath(flat: FlatCategory[], categoryId: string): string[] {
  const byId = new Map(flat.map((c) => [c.id, c]));
  const path: string[] = [];
  let current: FlatCategory | undefined = byId.get(categoryId);
  while (current) {
    path.unshift(current.name);
    current = current.parentCategoryId ? byId.get(current.parentCategoryId) : undefined;
  }
  return path;
}
