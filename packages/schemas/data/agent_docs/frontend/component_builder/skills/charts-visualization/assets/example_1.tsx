import {
  React,
  Charts,
  format,
  ToggleGroup,
  ToggleGroupItem,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Badge,
  useAppState,
  cn,
} from "@exepad/sdk";

interface DayData {
  date: string;
  pageViews: number;
  sessions: number;
  avgDuration: number;
  bounceRate: number;
}

const generateDemoData = (): DayData[] => {
  const data: DayData[] = [];
  const baseDate = new Date(2025, 2, 1);
  for (let i = 0; i < 30; i++) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() + i);
    const dayOfWeek = date.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const basePV = isWeekend ? 1200 : 2800;
    const baseSessions = isWeekend ? 450 : 1100;
    data.push({
      date: format(date, "MMM dd"),
      pageViews: basePV + Math.floor(Math.random() * 800),
      sessions: baseSessions + Math.floor(Math.random() * 300),
      avgDuration: 120 + Math.floor(Math.random() * 180),
      bounceRate: 30 + Math.floor(Math.random() * 25),
    });
  }
  return data;
};

const DEMO_DATA = generateDemoData();

const SUMMARY_STATS = [
  { label: "Total Page Views", value: "72,489", trend: "+12.3%", positive: true },
  { label: "Avg. Sessions/Day", value: "1,024", trend: "+8.7%", positive: true },
// ... (truncated)
