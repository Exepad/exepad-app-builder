// --- @exepad/sdk/charts ---
// recharts namespace + the shadcn chart wrappers. Single subpath so
// `<Charts.AreaChart><Charts.XAxis/>` share ONE recharts instance and
// child-identity inspection still works. Isolated entry => recharts can
// only ever appear in THIS chunk (enforced by check-split-chunks.mjs).
export { Charts } from '../visuals.charts';

export {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from '../components/ui/chart';
export type { ChartConfig } from '../components/ui/chart';
