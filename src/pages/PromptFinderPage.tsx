import React, { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { 
  Plus, 
  X, 
  Users, 
  Target, 
  Brain, 
  Lightbulb, 
  MessageSquare, 
  Globe2, 
  Tags, 
  Languages, 
  Hash, 
  Loader2, 
  Download, 
  Trash2, 
  Wand2, 
  Copy, 
  Check, 
  ShoppingCart, 
  Zap, 
  TrendingUp, 
  Search, 
  Route, 
  Layers, 
  Edit3, 
  BarChart3, 
  Eye, 
  Award 
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { supabase } from '../lib/supabase';

interface Persona {
  framework: string;
  name: string;
  age: number;
  occupation: string;
  theme_experience: string;
  goals: string;
  frustrations: string;
  queries: string[];
}

interface IcpProfile {
  framework: string;
  name: string;
  sector: string;
  entity_size: string;
  budget: string;
  challenges: string;
  objectives: string;
  queries: string[];
}

const languages = [
  'Allemand',
  'Anglais',
  'Arabe',
  'Bengali',
  'Chinois',
  'Coréen',
  'Espagnol',
  'Français',
  'Hindi',
  'Italien',
  'Japonais',
  'Néerlandais',
  'Polonais',
  'Portugais',
  'Punjabi',
  'Russe',
  'Swahili',
  'Tamoul',
  'Turc',
  'Vietnamien'
].sort();

const queryCountOptions = Array.from({ length: 5 }, (_, i) => (i + 1) * 10);

const resultsBasedFrameworks = [
  {
    id: 'inference',
    name: 'Inference via Landing Pages',
    icon: <Search className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />,
    description: 'Infer user queries from pages already receiving AI visits/hits.',
    example: 'Analyze titles or URLs to generate probable queries'
  },
  {
    id: 'seo',
    name: 'SEO Keywords Extension',
    icon: <Layers className="w-6 h-6 text-teal-600 dark:text-teal-400" />,
    description: 'Transform SEO keywords into natural questions for LLMs.',
    example: 'Reformulate keywords into realistic questions'
  }
];

const audienceBasedFrameworks = [
  {
    id: 'personas',
    name: 'Personas',
    icon: <Users className="w-6 h-6 text-blue-600 dark:text-blue-400" />,
    description: 'Generate queries based on the needs and behaviors of different user types.',
    example: 'Example: A busy professional looking for quick productivity solutions.'
  },
  {
    id: 'icp',
    name: 'Ideal Customer Profile (ICP)',
    icon: <Target className="w-6 h-6 text-green-600 dark:text-green-400" />,
    description: 'Generate queries based on the ideal customer profile for your product or service.',
    example: 'Example: A medium-sized company looking to optimize its processes.'
  },
  {
    id: 'jtbd',
    name: 'Jobs To Be Done (JTBD)',
    icon: <Target className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />,
    description: 'Identify the "job to be done" by the user through their query.',
    example: 'Format: "When I [situation], I want [action], so that [result]"'
  },
  {
    id: 'customer-journey',
    name: 'Customer Journey Map',
    icon: <Route className="w-6 h-6 text-purple-600 dark:text-purple-400" />,
    description: 'Generate queries based on customer journey stages, from awareness to post-purchase.',
    example: 'Covers all potential touchpoints between user and service/product via LLMs'
  },
  {
    id: 'pain-gain',
    name: 'Pain-Gain Matrix',
    icon: <TrendingUp className="w-6 h-6 text-red-600 dark:text-red-400" />,
    description: 'Generate queries from pain points or desired benefits.',
    example: 'Ex: "How to solve...", "How to improve..."'
  },
  {
    id: 'pas',
    name: 'Problem-Agitate-Solution',
    icon: <Zap className="w-6 h-6 text-amber-600 dark:text-amber-400" />,
    description: 'Structure queries by highlighting a problem and seeking a solution.',
    example: 'Format: Problem → Amplification → Solution'
  }
];

const specificFrameworks = [
  {
    id: 'archetypes',
    name: 'LLM Query Archetypes',
    icon: <Brain className="w-6 h-6 text-pink-600 dark:text-pink-400" />,
    description: 'Common query patterns adapted for LLMs.',
    example: '"Can you recommend...", "Explain how...", "Compare..."'
  },
  {
    id: 'best-of',
    name: 'Best of...',
    icon: <Award className="w-6 h-6 text-yellow-600 dark:text-yellow-400" />,
    description: 'Generate "Best of" or "Top" type queries to get recommendations.',
    example: '"Best tools for...", "Top solutions for..."'
  },
  {
    id: 'brand-perception',
    name: 'Brand Perception',
    icon: <Eye className="w-6 h-6 text-violet-600 dark:text-violet-400" />,
    description: 'Generate queries about brand reputation, reviews, and perception.',
    example: 'Questions about reviews, reliability, comparisons with other brands'
  }
];

export const PromptFinderPage: React.FC = () => {
  const [selectedFramework, setSelectedFramework] = useState<string | null>(null);
  const [domain, setDomain] = useState('');
  const [theme, setTheme] = useState('');
  const [language, setLanguage] = useState('Français');
  const [queryCount, setQueryCount] = useState(30);
  const [seoKeywords, setSeoKeywords] = useState('');
  const [loading, setLoading] = useState(false);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [icpProfiles, setIcpProfiles] = useState<IcpProfile[]>([]);
  const [selectedPersona, setSelectedPersona] = useState<Persona | null>(null);
  const [selectedIcp, setSelectedIcp] = useState<IcpProfile | null>(null);
  const [generatedQueries, setGeneratedQueries] = useState<Array<{ group: string; query: string }>>([]);
  const [copied, setCopied] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [urlsInput, setUrlsInput] = useState('');
  const [showCustomPersonaInput, setShowCustomPersonaInput] = useState(false);
  const [customPersonaDescription, setCustomPersonaDescription] = useState('');
  const [showCustomIcpInput, setShowCustomIcpInput] = useState(false);
  const [customIcpDescription, setCustomIcpDescription] = useState('');
  const [customIcpFields, setCustomIcpFields] = useState({
    sector: '',
    entity_size: '',
    budget: '',
    challenges: '',
    objectives: ''
  });
  const copyTimeoutRef = useRef<number | null>(null);

  const handleFrameworkSelect = (frameworkId: string) => {
    setSelectedFramework(frameworkId);
    setPersonas([]);
    setIcpProfiles([]);
    setSelectedPersona(null);
    setSelectedIcp(null);
    setGeneratedQueries([]);
    setValidationError(null);
    setSeoKeywords('');
    setShowCustomPersonaInput(false);
    setCustomPersonaDescription('');
    setShowCustomIcpInput(false);
    setCustomIcpDescription('');
    setCustomIcpFields({
      sector: '',
      entity_size: '',
      budget: '',
      challenges: '',
      objectives: ''
    });
  };

  const validateFields = () => {
    if (!selectedFramework) {
      setValidationError('Please select a framework');
      return false;
    }
    if (!domain.trim()) {
      setValidationError('Please enter a domain');
      return false;
    }
    if (!theme.trim()) {
      setValidationError('Please enter a theme');
      return false;
    }
    if (selectedFramework === 'seo' && !seoKeywords.trim()) {
      setValidationError('Please enter SEO keywords');
      return false;
    }
    if (selectedFramework === 'personas' && showCustomPersonaInput && !customPersonaDescription.trim()) {
      setValidationError('Please enter a persona description');
      return false;
    }
    if (selectedFramework === 'icp' && showCustomIcpInput) {
      if (!customIcpDescription.trim() && 
          (!customIcpFields.sector.trim() || 
           !customIcpFields.entity_size.trim() || 
           !customIcpFields.budget.trim() || 
           !customIcpFields.challenges.trim() || 
           !customIcpFields.objectives.trim())) {
        setValidationError('Please complete all ideal customer profile fields or provide a description');
        return false;
      }
    }
    setValidationError(null);
    return true;
  };

  const getButtonState = () => {
    if (loading) {
      return {
        disabled: true,
        text: 'Generating...',
        icon: <Loader2 size={20} className="animate-spin" />
      };
    }

    if (!selectedFramework || !domain || !theme) {
      return {
        disabled: true,
        text: 'Generate with AI',
        icon: <Wand2 size={20} />
      };
    }

    if (selectedFramework === 'personas') {
      if (showCustomPersonaInput) {
        if (!customPersonaDescription.trim()) {
          return {
            disabled: true,
            text: 'Enter a persona description',
            icon: <Edit3 size={20} />
          };
        }
        return {
          disabled: false,
          text: 'Generate queries with this persona',
          icon: <Wand2 size={20} />
        };
      }
      
      if (personas.length === 0) {
        return {
          disabled: false,
          text: 'Generate Personas',
          icon: <Users size={20} />
        };
      }
      if (!selectedPersona) {
        return {
          disabled: true,
          text: 'Select a Persona to generate queries',
          icon: <Users size={20} />
        };
      }
    }

    if (selectedFramework === 'icp') {
      if (showCustomIcpInput) {
        if (!customIcpDescription.trim() && 
            (!customIcpFields.sector.trim() || 
             !customIcpFields.entity_size.trim() || 
             !customIcpFields.budget.trim() || 
             !customIcpFields.challenges.trim() || 
             !customIcpFields.objectives.trim())) {
          return {
            disabled: true,
            text: 'Complete the ideal customer profile',
            icon: <Edit3 size={20} />
          };
        }
        return {
          disabled: false,
          text: 'Generate queries with this profile',
          icon: <Wand2 size={20} />
        };
      }
      
      if (icpProfiles.length === 0) {
        return {
          disabled: false,
          text: 'Generate Ideal Customer Profiles',
          icon: <Target size={20} />
        };
      }
      if (!selectedIcp) {
        return {
          disabled: true,
          text: 'Select a Customer Profile to generate queries',
          icon: <Target size={20} />
        };
      }
    }

    if (selectedFramework === 'inference' && !urlsInput.trim()) {
      return {
        disabled: true,
        text: 'Enter URLs or titles',
        icon: <MessageSquare size={20} />
      };
    }

    if (selectedFramework === 'seo' && !seoKeywords.trim()) {
      return {
        disabled: true,
        text: 'Enter SEO keywords',
        icon: <MessageSquare size={20} />
      };
    }

    return {
      disabled: false,
      text: 'Generate with AI',
      icon: <Wand2 size={20} />
    };
  };

  const generateQueriesFromCustomPersona = async () => {
    if (!validateFields()) {
      return;
    }

    setLoading(true);
    setValidationError(null);

    try {
      const response = await supabase.functions.invoke('personas', {
        body: {
          customPersona: {
            description: customPersonaDescription
          },
          domain,
          language,
          queryCount,
        },
      });

      if (response.error) {
        throw new Error(response.error.message || 'Failed to generate queries');
      }

      const queries = response.data;
      setGeneratedQueries(queries);
    } catch (error) {
      console.error('Error generating queries from custom persona:', error);
      setValidationError(error instanceof Error ? error.message : 'Failed to generate queries. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const generateQueriesFromCustomIcp = async () => {
    if (!validateFields()) {
      return;
    }

    setLoading(true);
    setValidationError(null);

    try {
      // Prepare custom ICP data
      let customIcp;
      
      if (customIcpDescription.trim()) {
        // If description is provided, use it
        customIcp = {
          description: customIcpDescription
        };
      } else {
        // Otherwise use the field values
        customIcp = {
          sector: customIcpFields.sector,
          entity_size: customIcpFields.entity_size,
          budget: customIcpFields.budget,
          challenges: customIcpFields.challenges,
          objectives: customIcpFields.objectives
        };
      }

      const response = await supabase.functions.invoke('icp', {
        body: {
          customIcp,
          domain,
          language,
          queryCount,
        },
      });

      if (response.error) {
        throw new Error(response.error.message || 'Failed to generate queries');
      }

      const queries = response.data;
      setGeneratedQueries(queries);
    } catch (error) {
      console.error('Error generating queries from custom ICP:', error);
      setValidationError(error instanceof Error ? error.message : 'Failed to generate queries. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const generateQueries = async () => {
    if (!validateFields()) {
      return;
    }

    // Handle custom persona case
    if (selectedFramework === 'personas' && showCustomPersonaInput) {
      await generateQueriesFromCustomPersona();
      return;
    }

    // Handle custom ICP case
    if (selectedFramework === 'icp' && showCustomIcpInput) {
      await generateQueriesFromCustomIcp();
      return;
    }

    setLoading(true);
    setValidationError(null);

    try {
      let response;
      
      if (selectedFramework === 'personas') {
        if (personas.length === 0) {
          response = await supabase.functions.invoke('personas', {
            body: {
              domain,
              theme,
              language,
            },
          });

          if (response.error) throw response.error;

          const generatedPersonas = response.data;
          setPersonas(generatedPersonas);
          setGeneratedQueries([]);
          setLoading(false);
          return;
        }

        if (selectedPersona) {
          response = await supabase.functions.invoke('personas', {
            body: {
              selectedPersona,
              domain,
              language,
              queryCount,
            },
          });
        }
      } else if (selectedFramework === 'archetypes') {
        response = await supabase.functions.invoke('archetypes', {
          body: {
            brand: domain,
            theme,
            queryCount,
            language,
          },
        });
      } else if (selectedFramework === 'pain-gain') {
        response = await supabase.functions.invoke('pain-gain', {
          body: {
            brand: domain,
            theme,
            queryCount,
            language,
          },
        });
      } else if (selectedFramework === 'pas') {
        response = await supabase.functions.invoke('pas', {
          body: {
            brand: domain,
            theme,
            queryCount,
            language,
          },
        });
      } else if (selectedFramework === 'customer-journey') {
        response = await supabase.functions.invoke('customer-journey', {
          body: {
            brand: domain,
            theme,
            queryCount,
            language,
          },
        });
      } else if (selectedFramework === 'jtbd') {
        response = await supabase.functions.invoke('jtbd', {
          body: {
            brand: domain,
            theme,
            queryCount,
            language,
          },
        });
      } else if (selectedFramework === 'inference') {
        const urls = urlsInput
          .split('\n')
          .map(line => line.trim())
          .filter(Boolean);

        if (urls.length === 0) {
          setValidationError('Please enter at least one URL or page title');
          setLoading(false);
          return;
        }

        response = await supabase.functions.invoke('inference', {
          body: {
            brand: domain,
            theme,
            language,
            urls,
          },
        });
      } else if (selectedFramework === 'icp') {
        if (icpProfiles.length === 0) {
          response = await supabase.functions.invoke('icp', {
            body: {
              domain,
              theme,
              language,
            },
          });

          if (response.error) throw response.error;

          const generatedProfiles = response.data;
          setIcpProfiles(generatedProfiles);
          setGeneratedQueries([]);
          setLoading(false);
          return;
        }

        if (selectedIcp) {
          response = await supabase.functions.invoke('icp', {
            body: {
              selectedIcp,
              domain,
              language,
              queryCount,
            },
          });
        }
      } else if (selectedFramework === 'best-of') {
        response = await supabase.functions.invoke('best-of', {
          body: {
            brand: domain,
            theme,
            language,
            queries_amount: queryCount,
          },
        });
      } else if (selectedFramework === 'brand-perception') {
        response = await supabase.functions.invoke('brand-perception', {
          body: {
            brand: domain,
            theme,
            language,
            queries_amount: queryCount,
          },
        });
      } else if (selectedFramework === 'seo') {
        const keywords = seoKeywords.split('\n').map(k => k.trim()).filter(Boolean);
        
        response = await supabase.functions.invoke('seo', {
          body: {
            brand: domain,
            theme,
            language,
            keywords,
          },
        });
      } else {
        throw new Error('Framework not implemented yet');
      }

      if (!response) {
        throw new Error('Invalid framework selected');
      }

      if (response.error) {
        throw new Error(response.error.message || 'Failed to generate queries');
      }

      const queries = response.data;
      setGeneratedQueries(queries);
    } catch (error) {
      console.error('Error generating queries:', error);
      setValidationError(error instanceof Error ? error.message : 'Failed to generate queries. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const removeQuery = (group: string, query: string) => {
    setGeneratedQueries(prev => prev.filter(q => !(q.group === group && q.query === query)));
  };

  const downloadQueries = () => {
    const content = generatedQueries
      .map(q => `${q.group};${q.query}`)
      .join('\n');

    const blob = new Blob([content], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'queries.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const copyQueries = async () => {
    const content = generatedQueries
      .map(q => `${q.group};${q.query}`)
      .join('\n');

    try {
      await navigator.clipboard.writeText(content);
      
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      
      setCopied(true);
      copyTimeoutRef.current = window.setTimeout(() => {
        setCopied(false);
        copyTimeoutRef.current = null;
      }, 2000);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  const getAvatarUrl = (persona: Persona) => {
    const seed = `${persona.name}-${persona.age}-${persona.occupation}`.toLowerCase().replace(/\s+/g, '-');
    return `https://api.dicebear.com/7.x/pixel-art/svg?seed=${encodeURIComponent(seed)}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`;
  };

  const getIcpAvatarUrl = (icp: IcpProfile) => {
    const seed = `${icp.name}-${icp.sector}`.toLowerCase().replace(/\s+/g, '-');
    return `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(seed)}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`;
  };

  const buttonState = getButtonState();

  const FrameworkCard = ({ framework, isSelected, onClick }: { framework: any, isSelected: boolean, onClick: () => void }) => (
    <button
      onClick={onClick}
      className="w-full text-left"
    >
      <Card 
        className={`h-full cursor-pointer transition-all duration-300 ${
          isSelected 
            ? 'ring-2 ring-brand-primary shadow-lg' 
            : 'hover:shadow-md hover:bg-gray-50 dark:hover:bg-gray-800'
        }`}
      >
        <CardContent className="pt-6">
          <div className="flex items-start gap-4">
            <div className={`p-2 rounded-lg ${
              isSelected 
                ? 'bg-brand-primary/10' 
                : 'bg-gray-50 dark:bg-gray-800'
            }`}>
              {framework.icon}
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <h3 className={`font-semibold ${
                  isSelected 
                    ? 'text-brand-primary' 
                    : 'text-gray-900 dark:text-gray-100'
                }`}>
                  {framework.name}
                </h3>
                {(framework.id === 'personas' || framework.id === 'icp') && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isSelected) {
                        if (framework.id === 'personas') {
                          setShowCustomPersonaInput(!showCustomPersonaInput);
                          setPersonas([]);
                          setSelectedPersona(null);
                        } else if (framework.id === 'icp') {
                          setShowCustomIcpInput(!showCustomIcpInput);
                          setIcpProfiles([]);
                          setSelectedIcp(null);
                        }
                        setGeneratedQueries([]);
                      }
                    }}
                    className={`p-1 rounded-full transition-colors ${
                      (showCustomPersonaInput && isSelected && framework.id === 'personas') || 
                      (showCustomIcpInput && isSelected && framework.id === 'icp')
                        ? 'bg-brand-primary/10 text-brand-primary'
                        : 'hover:bg-gray-100 text-gray-500 dark:hover:bg-gray-700 dark:text-gray-400'
                    }`}
                    title={framework.id === 'personas' ? "Add your own persona description" : "Add your own ideal customer profile"}
                  >
                    <Edit3 size={16} />
                  </button>
                )}
              </div>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {framework.description}
              </p>
              <div className="mt-2 text-xs text-gray-400 dark:text-gray-500 italic">
                {framework.example}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </button>
  );

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
          Prompt Finder
        </h1>
        <p className="text-gray-600 dark:text-gray-300 mt-1">
          Generate optimized queries for LLMs using different frameworks
        </p>
      </motion.div>

      <div className="space-y-12">
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200 dark:border-gray-700"></div>
          </div>
          <div className="relative flex justify-center">
            <div className="px-4 bg-gray-50 dark:bg-gray-900">
              <div className="h-8 w-8 rounded-full bg-gradient-to-r from-brand-primary to-brand-secondary flex items-center justify-center text-white font-bold">
                1
              </div>
            </div>
          </div>
        </div>

        <Card className="overflow-hidden">
          <CardHeader>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Configuration</h2>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <Input
                label="Brand / Company / Website *"
                value={domain}
                onChange={(e) => {
                  setDomain(e.target.value);
                  setValidationError(null);
                }}
                icon={<Globe2 className="w-5 h-5" />}
                placeholder="www.example.com"
                required
              />
              
              <Input
                label="Theme(s) *"
                value={theme}
                onChange={(e) => {
                  setTheme(e.target.value);
                  setValidationError(null);
                }}
                icon={<Tags className="w-5 h-5" />}
                placeholder="insurance"
                required
              />
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Language
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Languages className="w-5 h-5 text-gray-400" />
                  </div>
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="block w-full pl-10 pr-4 py-2.5 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-2xl text-gray-900 dark:text-gray-100 focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20"
                  >
                    {languages.map((lang) => (
                      <option key={lang} value={lang}>
                        {lang}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Number of queries
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Hash className="w-5 h-5 text-gray-400" />
                  </div>
                  <select
                    value={queryCount}
                    onChange={(e) => setQueryCount(Number(e.target.value))}
                    className="block w-full pl-10 pr-4 py-2.5 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-2xl text-gray-900 dark:text-gray-100 focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20"
                  >
                    {queryCountOptions.map((count) => (
                      <option key={count} value={count}>
                        {count}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200 dark:border-gray-700"></div>
          </div>
          <div className="relative flex justify-center">
            <div className="px-4 bg-gray-50 dark:bg-gray-900">
              <div className="h-8 w-8 rounded-full bg-gradient-to-r from-brand-primary to-brand-secondary flex items-center justify-center text-white font-bold">
                2
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-12">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 text-center">Choose a framework *</h2>
          
          {/* Results-based Frameworks */}
          <div className="bg-gradient-to-r from-indigo-50 to-teal-50 dark:from-indigo-900/20 dark:to-teal-900/20 rounded-2xl p-8 border border-indigo-100 dark:border-indigo-800">
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-indigo-500 to-teal-500 rounded-full mb-4">
                <BarChart3 className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">Results-based Frameworks</h3>
              <p className="text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
                Generate queries from existing data and observed results
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
              {resultsBasedFrameworks.map((framework) => (
                <FrameworkCard
                  key={framework.id}
                  framework={framework}
                  isSelected={selectedFramework === framework.id}
                  onClick={() => handleFrameworkSelect(framework.id)}
                />
              ))}
            </div>
          </div>

          {/* Audience-based Frameworks */}
          <div className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 rounded-2xl p-8 border border-blue-100 dark:border-blue-800">
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full mb-4">
                <Users className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">Audience-based Frameworks</h3>
              <p className="text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
                Create queries based on user profiles and behaviors
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {audienceBasedFrameworks.map((framework) => (
                <FrameworkCard
                  key={framework.id}
                  framework={framework}
                  isSelected={selectedFramework === framework.id}
                  onClick={() => handleFrameworkSelect(framework.id)}
                />
              ))}
            </div>
          </div>

          {/* Specific Frameworks */}
          <div className="bg-gradient-to-r from-pink-50 to-amber-50 dark:from-pink-900/20 dark:to-amber-900/20 rounded-2xl p-8 border border-pink-100 dark:border-pink-800">
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-pink-500 to-amber-500 rounded-full mb-4">
                <Lightbulb className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">Specific Frameworks</h3>
              <p className="text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
                Use specialized frameworks for specific use cases
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {specificFrameworks.map((framework) => (
                <FrameworkCard
                  key={framework.id}
                  framework={framework}
                  isSelected={selectedFramework === framework.id}
                  onClick={() => handleFrameworkSelect(framework.id)}
                />
              ))}
            </div>
          </div>

          {validationError && (
            <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300">
              {validationError}
            </div>
          )}

          {selectedFramework === 'seo' && (
            <div className="mt-8">
              <Card>
                <CardHeader>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">SEO Keywords</h3>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Enter your SEO keywords (one per line) to transform them into natural questions.
                    </p>
                    <textarea
                      value={seoKeywords}
                      onChange={(e) => setSeoKeywords(e.target.value)}
                      placeholder="car insurance&#10;home insurance&#10;life insurance&#10;..."
                      className="w-full h-40 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent transition-all font-mono text-sm dark:bg-gray-800 dark:text-gray-100"
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {selectedFramework === 'inference' && (
            <div className="mt-8">
              <Card>
                <CardHeader>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">URLs or Page Titles</h3>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Enter URLs or page titles (one per line) to infer probable queries.
                    </p>
                    <textarea
                      value={urlsInput}
                      onChange={(e) => setUrlsInput(e.target.value)}
                      placeholder="https://example.com/page-1&#10;How to apply for an ID card&#10;Steps to start your business&#10;..."
                      className="w-full h-40 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent transition-all font-mono text-sm dark:bg-gray-800 dark:text-gray-100"
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {selectedFramework === 'personas' && showCustomPersonaInput && (
            <div className="mt-8">
              <Card>
                <CardHeader>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                    <Edit3 className="w-5 h-5 text-brand-primary" />
                    Custom Persona
                  </h3>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Describe your custom persona to generate targeted queries.
                    </p>
                    <textarea
                      value={customPersonaDescription}
                      onChange={(e) => setCustomPersonaDescription(e.target.value)}
                      placeholder="Describe your persona: age, occupation, goals, frustrations, etc."
                      className="w-full h-32 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent transition-all dark:bg-gray-800 dark:text-gray-100"
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {selectedFramework === 'personas' && personas.length > 0 && !showCustomPersonaInput && (
            <div className="mt-8">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Select a persona</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {personas.map((persona, index) => (
                  <button
                    key={index}
                    onClick={() => setSelectedPersona(persona)}
                    className="w-full text-left"
                  >
                    <Card
                      className={`h-full cursor-pointer transition-all duration-300 ${
                        selectedPersona === persona
                          ? 'ring-2 ring-brand-primary shadow-lg transform scale-[1.02]'
                          : 'hover:shadow-md hover:bg-gray-50 dark:hover:bg-gray-800'
                      }`}
                    >
                      <CardContent className="pt-6">
                        <div className="space-y-6">
                          <div className="flex items-center gap-4">
                            <div className="h-16 w-16 rounded-full overflow-hidden bg-gray-100 dark:bg-gray-700">
                              <img
                                src={getAvatarUrl(persona)}
                                alt={persona.name}
                                className="w-full h-full object-contain"
                              />
                            </div>
                            <div>
                              <h4 className={`text-lg font-semibold ${
                                selectedPersona === persona
                                  ? 'text-brand-primary'
                                  : 'text-gray-900 dark:text-gray-100'
                              }`}>
                                {persona.name}
                              </h4>
                              <p className="text-sm text-gray-600 dark:text-gray-400">{persona.age} ans</p>
                              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{persona.occupation}</p>
                            </div>
                          </div>

                          <div className="space-y-4">
                            <div>
                              <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-2">
                                <Target className="h-4 w-4 text-green-600 dark:text-green-400" />
                                Objectifs
                              </h5>
                              <p className="text-sm text-gray-600 dark:text-gray-400">{persona.goals}</p>
                            </div>
                            <div>
                              <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-2">
                                <X className="h-4 w-4 text-red-600 dark:text-red-400" />
                                Frustrations
                              </h5>
                              <p className="text-sm text-gray-600 dark:text-gray-400">{persona.frustrations}</p>
                            </div>
                            <div>
                              <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-2">
                                <Brain className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                                Expérience thématique
                              </h5>
                              <p className="text-sm text-gray-600 dark:text-gray-400">{persona.theme_experience}</p>
                            </div>
                          </div>

                          <div>
                            <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
                              <MessageSquare className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                              Exemples de requêtes
                            </h5>
                            <div className="space-y-2">
                              {persona.queries.map((query, qIndex) => (
                                <div
                                  key={qIndex}
                                  className="text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-3 py-2 rounded-lg"
                                >
                                  {query}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </button>
                ))}
              </div>
            </div>
          )}

          {selectedFramework === 'icp' && showCustomIcpInput && (
            <div className="mt-8">
              <Card>
                <CardHeader>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                    <Edit3 className="w-5 h-5 text-brand-primary" />
                    Custom Ideal Customer Profile
                  </h3>
                </CardHeader>
                <CardContent>
                  <div className="space-y-6">
                    <div>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                        You can either describe your ideal customer profile in free text, or fill in the specific fields below.
                      </p>
                      <textarea
                        value={customIcpDescription}
                        onChange={(e) => setCustomIcpDescription(e.target.value)}
                        placeholder="Free description of the ideal customer profile..."
                        className="w-full h-32 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent transition-all dark:bg-gray-800 dark:text-gray-100"
                      />
                    </div>
                    
                    <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                      <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-4">Or fill in the specific fields:</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Input
                          label="Industry Sector"
                          value={customIcpFields.sector}
                          onChange={(e) => setCustomIcpFields({...customIcpFields, sector: e.target.value})}
                          placeholder="Ex: Banking sector, Retail, etc."
                        />
                        <Input
                          label="Entity Size"
                          value={customIcpFields.entity_size}
                          onChange={(e) => setCustomIcpFields({...customIcpFields, entity_size: e.target.value})}
                          placeholder="Ex: SME with 50-100 employees"
                        />
                        <Input
                          label="Budget"
                          value={customIcpFields.budget}
                          onChange={(e) => setCustomIcpFields({...customIcpFields, budget: e.target.value})}
                          placeholder="Ex: $10-15k per month"
                        />
                        <Input
                          label="Challenges / Problems"
                          value={customIcpFields.challenges}
                          onChange={(e) => setCustomIcpFields({...customIcpFields, challenges: e.target.value})}
                          placeholder="Ex: Difficulty managing acquisition costs"
                        />
                        <div className="md:col-span-2">
                          <Input
                            label="Objectives"
                            value={customIcpFields.objectives}
                            onChange={(e) => setCustomIcpFields({...customIcpFields, objectives: e.target.value})}
                            placeholder="Ex: Increase marketing campaign ROI by 20%"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {selectedFramework === 'icp' && icpProfiles.length > 0 && !showCustomIcpInput && (
            <div className="mt-8">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Select an ideal customer profile</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {icpProfiles.map((icp, index) => (
                  <button
                    key={index}
                    onClick={() => setSelectedIcp(icp)}
                    className="w-full text-left"
                  >
                    <Card
                      className={`h-full cursor-pointer transition-all duration-300 ${
                        selectedIcp === icp
                          ? 'ring-2 ring-brand-primary shadow-lg transform scale-[1.02]'
                          : 'hover:shadow-md hover:bg-gray-50 dark:hover:bg-gray-800'
                      }`}
                    >
                      <CardContent className="pt-6">
                        <div className="space-y-6">
                          <div className="flex items-center gap-4">
                            <div className="h-16 w-16 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-700">
                              <img
                                src={getIcpAvatarUrl(icp)}
                                alt={icp.name}
                                className="w-full h-full object-contain"
                              />
                            </div>
                            <div>
                              <h4 className={`text-lg font-semibold ${
                                selectedIcp === icp
                                  ? 'text-brand-primary'
                                  : 'text-gray-900 dark:text-gray-100'
                              }`}>
                                {icp.name}
                              </h4>
                              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{icp.sector}</p>
                            </div>
                          </div>

                          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                            <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Size</h5>
                            <p className="text-sm text-gray-600 dark:text-gray-400">{icp.entity_size}</p>
                          </div>

                          <div className="space-y-4">
                            <div>
                              <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-2">
                                <ShoppingCart className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                                Budget
                              </h5>
                              <p className="text-sm text-gray-600 dark:text-gray-400">{icp.budget}</p>
                            </div>
                            <div>
                              <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-2">
                                <X className="h-4 w-4 text-red-600 dark:text-red-400" />
                                Challenges
                              </h5>
                              <p className="text-sm text-gray-600 dark:text-gray-400">{icp.challenges}</p>
                            </div>
                            <div>
                              <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-2">
                                <Target className="h-4 w-4 text-green-600 dark:text-green-400" />
                                Objectives
                              </h5>
                              <p className="text-sm text-gray-600 dark:text-gray-400">{icp.objectives}</p>
                            </div>
                          </div>

                          <div>
                            <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
                              <MessageSquare className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                              Example queries
                            </h5>
                            <div className="space-y-2">
                              {icp.queries.map((query, qIndex) => (
                                <div
                                  key={qIndex}
                                  className="text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-3 py-2 rounded-lg"
                                >
                                  {query}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </button>
                ))}
              </div>
            </div>
          )}

          {generatedQueries.length > 0 && (
            <div className="mt-8">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Generated queries</h3>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    onClick={copyQueries}
                    className="flex items-center gap-2"
                  >
                    {copied ? (
                      <>
                        <Check size={16} className="text-green-500" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy size={16} />
                        Copy
                      </>
                    )}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={downloadQueries}
                    className="flex items-center gap-2"
                  >
                    <Download size={16} />
                    Download
                  </Button>
                </div>
              </div>
              <div className="space-y-6">
                {Array.from(new Set(generatedQueries.map(q => q.group))).map(group => (
                  <div key={group} className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
                    <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">{group}</h4>
                    <div className="space-y-2">
                      {generatedQueries
                        .filter(q => q.group === group)
                        .map((query, index) => (
                          <div
                            key={index}
                            className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-700 rounded-lg text-sm text-gray-700 dark:text-gray-300 group hover:bg-gray-100 dark:hover:bg-gray-600"
                          >
                            <span>{query.query}</span>
                            <button
                              onClick={() => removeQuery(group, query.query)}
                              className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-200 dark:hover:bg-gray-500 rounded-full transition-opacity"
                            >
                              <Trash2 size={16} className="text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400" />
                            </button>
                          </div>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-center pt-8">
            <Button
              onClick={generateQueries}
              disabled={buttonState.disabled}
              variant="gradient"
              className="flex items-center gap-2 px-8 py-3 text-lg font-medium"
            >
              {buttonState.icon}
              {buttonState.text}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};