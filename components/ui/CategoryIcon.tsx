import {
  Banknote,
  Gift,
  Percent,
  PlusCircle,
  Home,
  Zap,
  Wrench,
  Shield,
  Fuel,
  Car,
  TrainFront,
  CircleParking,
  ShoppingCart,
  Utensils,
  Coffee,
  Shirt,
  Scissors,
  Dumbbell,
  Repeat,
  Stethoscope,
  Smile,
  Pill,
  HeartPulse,
  Tv,
  Palette,
  Plane,
  Ticket,
  PiggyBank,
  TrendingUp,
  CreditCard,
  Receipt,
  Heart,
  CircleEllipsis,
  Tag,
  type LucideProps,
} from "lucide-react";

// Keys match the icon names seeded by seed_default_categories()
// (20260805000004_04_hardening.sql). Custom categories may store an
// unrecognized value -- ICON_MAP falls back to Tag for those.
const ICON_MAP: Record<string, React.ComponentType<LucideProps>> = {
  banknote: Banknote,
  gift: Gift,
  percent: Percent,
  "plus-circle": PlusCircle,
  home: Home,
  zap: Zap,
  wrench: Wrench,
  shield: Shield,
  fuel: Fuel,
  car: Car,
  "train-front": TrainFront,
  "circle-parking": CircleParking,
  "shopping-cart": ShoppingCart,
  utensils: Utensils,
  coffee: Coffee,
  shirt: Shirt,
  scissors: Scissors,
  dumbbell: Dumbbell,
  repeat: Repeat,
  stethoscope: Stethoscope,
  smile: Smile,
  pill: Pill,
  "heart-pulse": HeartPulse,
  tv: Tv,
  palette: Palette,
  plane: Plane,
  ticket: Ticket,
  "piggy-bank": PiggyBank,
  "trending-up": TrendingUp,
  "credit-card": CreditCard,
  receipt: Receipt,
  heart: Heart,
  "circle-ellipsis": CircleEllipsis,
};

// Keys a category's icon field is allowed to hold -- also drives the icon
// picker on the create/edit forms.
export const CATEGORY_ICON_NAMES = Object.keys(ICON_MAP);

export function CategoryIcon({
  icon,
  className = "h-4 w-4",
}: {
  icon: string | null;
  className?: string;
}) {
  const Icon = (icon && ICON_MAP[icon]) || Tag;
  return <Icon className={className} strokeWidth={1.75} aria-hidden="true" />;
}
