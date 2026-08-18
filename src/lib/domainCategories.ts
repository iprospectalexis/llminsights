// Global domain categories (mirrors the domain_categories table CHECK list).
// 'Own Brand' / 'Competitor' are project-relative overlays computed in the UI,
// 'Unknown' means no row yet — none of the three is stored in the table.

export const DOMAIN_CATEGORIES = [
  'Corporate',
  'News/Media',
  'Review/Comparison',
  'Marketplace/Retail',
  'Social Media',
  'Community/Forum',
  'Video',
  'Encyclopedia/Reference',
  'Education',
  'Government/NGO',
  'Blogs/Personal',
  'Other',
] as const;

export type DomainCategory = (typeof DOMAIN_CATEGORIES)[number];

const CATEGORY_STYLES: Record<string, string> = {
  'Own Brand': 'bg-brand-primary/10 text-brand-primary dark:bg-brand-primary/20 ring-1 ring-brand-primary/30',
  Competitor: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  Corporate: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  'News/Media': 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  'Review/Comparison': 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  'Marketplace/Retail': 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  'Social Media': 'bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300',
  'Community/Forum': 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  Video: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  'Encyclopedia/Reference': 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  Education: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
  'Government/NGO': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  'Blogs/Personal': 'bg-lime-100 text-lime-700 dark:bg-lime-900/40 dark:text-lime-300',
  Other: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  Unknown: 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500',
};

export function categoryChipClass(category: string): string {
  return `inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium whitespace-nowrap ${
    CATEGORY_STYLES[category] || CATEGORY_STYLES.Unknown
  }`;
}
