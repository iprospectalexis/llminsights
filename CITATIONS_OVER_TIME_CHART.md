# Citations Over Time Chart Implementation

## Overview

Added a new "Citations Over Time" chart to the Project Detail Page's Overview tab, following the same design pattern as the existing "Brand Mentions Over Time" chart.

## What Was Added

### 1. New Function: `getCitationsOverTime()`
**Location**: `src/pages/ProjectDetailPage.tsx` (after `getMentionRateByAuditDate`)

**Purpose**: Calculates citation counts per domain across all audit dates

**Key Features**:
- Groups citations by audit date
- Applies existing filters (LLM, prompt groups, sentiment, custom date range)
- Calculates total citations per date
- Calculates citations per domain (project domain + competitor domains)
- Respects project's domain mode (exact vs subdomains)

**Returns**:
```typescript
{
  chartData: Array<{
    date: string,           // Formatted date (e.g., "Jan 15")
    fullDate: string,       // ISO date for sorting
    total: number,          // Total citations
    'My Domain': number,    // Citations for project domain
    [domain]: number        // Citations for each competitor domain
  }>,
  projectDomain: string,
  competitorDomains: Array<{ domain: string, name: string }>
}
```

### 2. New State Variables

```typescript
const [showCompetitorsInCitationsTrend, setShowCompetitorsInCitationsTrend] = useState(true);
const [selectedCitationsTrendCompetitors, setSelectedCitationsTrendCompetitors] = useState<string[]>([]);
```

**Purpose**:
- `showCompetitorsInCitationsTrend`: Toggle to show/hide competitor domains
- `selectedCitationsTrendCompetitors`: Array of selected competitor domains to display

### 3. New Chart Component

**Location**: Added between "Brand Mentions Over Time" and "Brand Leadership" charts

**Features**:
- Line chart showing citation evolution over time
- Actual domain labels (e.g., "example.com") instead of generic labels
- Project domain line (solid, colored)
- Top 15 cited domains available for selection
- Default shows: project domain + top 3 cited domains
- Checkbox to show/hide domain selection
- Multi-select up to 15 domains with citation counts
- Color consistency using `getBrandColor()` function
- Responsive design with proper spacing
- Info tooltip explaining the chart

## Design Decisions

### Color Scheme
- **Project Domain**: Solid colored line (from brand color scheme)
- **Other Domains**: Dashed colored lines (from brand color scheme)
- Uses the same `BRAND_COLOR_SCHEME` as other charts for consistency
- Each domain gets a unique color from the color scheme

### Line Styles
- **Project Domain**: Solid line with larger dots (strokeWidth=3, r=5)
- **Other Domains**: Dashed lines with medium dots (strokeDasharray="5 5", strokeWidth=2, r=4)
- No separate "Total Citations" line - shows individual domain trends only

### Default Selection
- **On First Load**: Automatically selects project domain + top 3 cited domains
- **Top Domains**: Calculated by total citation count across all filtered citations
- **User Control**: Users can select/deselect any of the top 15 domains

### Filters Applied
The chart respects all existing filters:
- **LLM Filter**: Show citations only from selected LLM
- **Prompt Group Filter**: Show citations only from selected groups
- **Sentiment Filter**: Show citations only with selected sentiment
- **Date Range Filter**: Apply custom date range when selected
- **Note**: Shows all audit dates by default (unless custom date range is set)

### Domain Matching Logic
- **Exact Mode**: Citation domain must exactly match project/competitor domain
- **Subdomains Mode**: Citation domain can be exact match or subdomain
- All domains normalized (lowercase, www. removed)

## User Interface

### Chart Header
- Title: "Citations Over Time"
- Info icon with tooltip explaining the chart
- Subtitle: "Citation counts across audit dates"

### Controls
1. **Show Competitor Domains**: Checkbox to toggle competitor visibility
2. **Top 15 Cited Domains Selection**:
   - Shows top 15 most cited domains with citation counts
   - Click to select/deselect domains
   - Selected domains appear with colored background
   - "Clear all" button when selections exist
   - **Default Selection**: Project domain + top 3 cited domains (automatically selected on first load)

### Chart Elements
- **X-Axis**: Audit dates (formatted as "Jan 15")
- **Y-Axis**: Citation counts (absolute numbers, not percentages)
- **Legend**: Shows all visible lines with actual domain names
- **Tooltip**: Displays exact values on hover with domain names
- **Grid**: Light dashed grid for easier reading
- **Domain Labels**: Shows actual domain names (e.g., "example.com") instead of generic labels

### Empty State
When no citation data is available:
- Shows TrendingUp icon
- Message: "No citation data available"
- Hint: "Run multiple audits to see citation trends"

## Differences from Brand Mentions Chart

| Feature | Brand Mentions | Citations Over Time |
|---------|---------------|-------------------|
| **Data Source** | `llmResponses` with brand data | `processedCitations` |
| **Y-Axis** | Percentage (mention rate) | Absolute count |
| **Total Line** | Not shown | Not shown (removed) |
| **Entities** | Brands | Domains |
| **Domain Mode** | N/A | Respects exact/subdomain mode |
| **Formula** | (Mentions / Total) × 100 | Direct count |
| **Labels** | Brand names | Actual domain names |
| **Default Selection** | Project brands + selected competitors | Project domain + top 3 cited domains |
| **Selection Source** | Top competitors by mentions | Top 15 domains by citation count |

## Integration

### Position in UI
Located in the Overview tab, between:
1. ✅ Brand Mentions Over Time
2. ✅ **Citations Over Time** (new)
3. ✅ Brand Leadership

### Data Flow
```
processedCitations → getCitationsOverTime() → chartData → LineChart
                ↓
         Apply filters (LLM, groups, sentiment, date range)
                ↓
         Count citations by domain (get top 15)
                ↓
         Group by audit date
                ↓
         Calculate per-domain counts for each date
                ↓
         Auto-select top 3 + project domain on first load
```

## Technical Implementation

### File Modified
- `src/pages/ProjectDetailPage.tsx`

### Lines Added
- ~200 lines (function + UI component)

### Dependencies Used
- `recharts`: LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend
- `lucide-react`: Info, TrendingUp icons
- Existing state management and filter infrastructure

### Performance
- Uses existing `processedCitations` data (no additional queries)
- Efficient Map-based grouping
- Filters applied once during data processing
- Memoized through React's rendering cycle

## Testing Checklist

✅ Chart renders with citation data
✅ Empty state shows when no data
✅ Project domain line displays with actual domain name
✅ Top 3 domains auto-selected on first load
✅ Domain selection can be toggled
✅ Individual domains can be selected/deselected (up to 15)
✅ Domain names display with citation counts in badges
✅ Actual domain labels show in legend and tooltip
✅ Colors are consistent across charts
✅ Filters apply correctly (LLM, groups, sentiment, date range)
✅ Custom date range works
✅ Tooltip shows correct values with domain names
✅ Legend displays all visible lines with domain names
✅ Responsive design works
✅ Dark mode styling correct
✅ "Clear all" button works

## Future Enhancements

Possible improvements:
- Add citation rate (percentage) as an option
- Show citation growth rate between audits
- Add trend indicators (up/down arrows)
- Export chart data
- Add date range selector within the chart
- Show LLM breakdown per domain
- Add moving average line

## Recent Updates (2026-02-25)

### Changes Made:
1. **Removed "Total Citations" line** - Chart now shows only individual domain trends
2. **Added actual domain labels** - Uses real domain names (e.g., "example.com") instead of generic "My Domain"
3. **Auto-select top domains** - Automatically selects project domain + top 3 cited domains on first load
4. **Updated selection UI** - Shows "Top 15 Cited Domains" with citation counts in badges
5. **Improved data calculation** - Calculates top domains by total citation count across all filtered data

### Technical Changes:
- Modified `getCitationsOverTime()` to return `topDomains` instead of `competitorDomains`
- Added domain count aggregation logic
- Updated chart to use actual domain names as dataKeys
- Removed "Total Citations" and "My Domain" generic lines
- Added automatic default selection on component mount
- Updated all domain references to use actual domain strings

---

**Added**: 2026-02-25
**Last Updated**: 2026-02-25
**File**: `src/pages/ProjectDetailPage.tsx`
**Type**: Feature Addition & Enhancement
**Status**: ✅ Complete
