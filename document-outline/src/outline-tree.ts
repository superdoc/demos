export type OutlineLabel = {
  id: string;
  text: string;
  level: number;
  source?: "heading" | "detected";
};
export type OutlineNode<T extends OutlineLabel> = {
  item: T;
  children: OutlineNode<T>[];
};
export function outlineTree<T extends OutlineLabel>(
  items: T[],
): OutlineNode<T>[] {
  const roots: OutlineNode<T>[] = [],
    stack: OutlineNode<T>[] = [];
  for (const item of items) {
    while (stack.length && stack[stack.length - 1].item.level >= item.level)
      stack.pop();
    const node = { item, children: [] };
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack.push(node);
  }
  return roots;
}
