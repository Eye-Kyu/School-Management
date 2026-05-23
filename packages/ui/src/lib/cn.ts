// Tiny className combiner. We define our own to avoid adding `clsx` and
// `tailwind-merge` as deps until shadcn components actually need them
// (shadcn pulls them in automatically when you `add` a component).
export function cn(...inputs: Array<string | undefined | false | null>): string {
  return inputs.filter(Boolean).join(' ');
}
