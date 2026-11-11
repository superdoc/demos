/** Plain outline data shared by generators and renderers. No editor dependency. */
export type OutlineMode = 'headings' | 'custom';

export type OutlineLabel = {
  id: string;
  text: string;
  level: number;
};

export type OutlineSkeletonNode = {
  readonly id: string;
  readonly text: string;
  readonly children: OutlineSkeleton;
};

/** A nested, serializable outline that any renderer can consume. */
export type OutlineSkeleton = readonly OutlineSkeletonNode[];
