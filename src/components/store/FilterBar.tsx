import { Chip } from '../ui/Chip';

const categories = [
  { label: 'All', value: undefined },
  { label: 'Pen Cases', value: 'pen-cases' },
  { label: 'Carry Cases', value: 'carry-cases' },
  { label: 'Accessories', value: 'accessories' },
];

interface FilterBarProps {
  activeCategory: string | undefined;
  onCategoryChange: (category: string | undefined) => void;
}

export function FilterBar({ activeCategory, onCategoryChange }: FilterBarProps) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide">
      {categories.map((cat) => (
        <Chip
          key={cat.label}
          active={activeCategory === cat.value}
          onClick={() => onCategoryChange(cat.value)}
        >
          {cat.label}
        </Chip>
      ))}
    </div>
  );
}
