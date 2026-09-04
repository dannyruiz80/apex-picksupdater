import {
  TrendingUp,
  Gauge,
  Radio,
  Layers,
  Sparkles,
  Cpu,
  GraduationCap,
  BookmarkCheck,
  FileCheck2,
  Wrench,
  LayoutDashboard,
} from 'lucide-react';
import { NavItem, NavTabId } from './types';

export const NAVIGATION_ITEMS: NavItem[] = [
  {
    id: 'overview',
    label: 'Overview',
    shortLabel: 'Hub',
    iconName: 'LayoutDashboard',
    description: 'System baseline metrics, telemetry & engine health status',
    category: 'System',
  },
  {
    id: 'picks',
    label: 'Picks',
    shortLabel: 'Picks',
    iconName: 'TrendingUp',
    description: 'Algorithmic point spreads, moneylines, and model projections',
    category: 'Core',
  },
  {
    id: 'win-probability',
    label: 'Win Probability',
    shortLabel: 'Win P',
    iconName: 'Gauge',
    description: 'Independent moneyline win probabilities plus spread/total value recommendations',
    category: 'Core',
  },
  {
    id: 'live',
    label: 'Live',
    shortLabel: 'Live',
    iconName: 'Radio',
    description: 'Real-time in-game market updates and in-play momentum models',
    category: 'Core',
  },
  {
    id: 'props',
    label: 'Props',
    shortLabel: 'Props',
    iconName: 'Layers',
    description: 'Player performance analytics, micro-lines, and usage distributions',
    category: 'Core',
  },
  {
    id: 'parlays',
    label: 'Parlays',
    shortLabel: 'Parlays',
    iconName: 'Sparkles',
    description: 'Executable qualified-leg parlays with common-book pricing, correlation guardrails and ticket stake sizing',
    category: 'Core',
  },
  {
    id: 'sims',
    label: 'Sims',
    shortLabel: 'Sims',
    iconName: 'Cpu',
    description: 'Verified 10,000x simulation lab; MLB pitcher-K model active, team sims fail-closed until validated',
    category: 'Engine',
  },
  {
    id: 'ai-learn',
    label: 'AI Learn',
    shortLabel: 'AI Learn',
    iconName: 'GraduationCap',
    description: 'Quantitative betting education, market theory & backtest lessons',
    category: 'Engine',
  },
  {
    id: 'my-bets',
    label: 'My Bets',
    shortLabel: 'My Bets',
    iconName: 'BookmarkCheck',
    description: 'Current bankroll, dollar unit sizing, exposure caps and tracked bet ledger',
    category: 'Account',
  },
  {
    id: 'audit',
    label: 'Audit',
    shortLabel: 'Audit',
    iconName: 'FileCheck2',
    description: 'Transparent model historical performance and accuracy logs',
    category: 'System',
  },
  {
    id: 'tools',
    label: 'Tools',
    shortLabel: 'Tools',
    iconName: 'Wrench',
    description: 'Arbitrage finder, devigging calculators, and Kelly sizing tools',
    category: 'System',
  },
];

export const getNavIcon = (id: NavTabId) => {
  switch (id) {
    case 'overview':
      return LayoutDashboard;
    case 'picks':
      return TrendingUp;
    case 'win-probability':
      return Gauge;
    case 'live':
      return Radio;
    case 'props':
      return Layers;
    case 'parlays':
      return Sparkles;
    case 'sims':
      return Cpu;
    case 'ai-learn':
      return GraduationCap;
    case 'my-bets':
      return BookmarkCheck;
    case 'audit':
      return FileCheck2;
    case 'tools':
      return Wrench;
    default:
      return LayoutDashboard;
  }
};
