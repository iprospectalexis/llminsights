import React, { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { supabase } from '../../lib/supabase';
import { parsePrompts } from '../../utils/prompts';
import { countries, getCountryByCode } from '../../utils/countries';
import { Sparkles, X } from 'lucide-react';

const colorPalette = {
  'rose': '#f72585',
  'fandango': '#b5179e',
  'grape': '#7209b7',
  'chrysler_blue': '#560bad',
  'dark_blue': '#480ca8',
  'zaffre': '#3a0ca3',
  'palatinate_blue': '#3f37c9',
  'neon_blue': '#4361ee',
  'chefchaouen_blue': '#4895ef',
  'vivid_sky_blue': '#4cc9f0',
};

interface CreateProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const CreateProjectModal: React.FC<CreateProjectModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<any[]>([]);
  const [brandsList, setBrandsList] = useState<string[]>([]);
  const [competitorsList, setCompetitorsList] = useState<string[]>([]);
  const [groupMode, setGroupMode] = useState<'existing' | 'new'>('existing');
  const [errors, setErrors] = useState<any>({});
  const [suggestingCompetitors, setSuggestingCompetitors] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    groupId: '',
    newGroupName: '',
    newGroupColor: '#6366f1',
    domain: '',
    domainMode: 'exact' as 'exact' | 'subdomains',
    country: 'US',
    myBrands: '',
    competitors: '',
    prompts: '',
    llms: ['searchgpt', 'perplexity', 'gemini'],
  });

  useEffect(() => {
    getCurrentUser();
    if (isOpen) {
      fetchGroups();
    }
  }, [isOpen]);

  const getCurrentUser = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    setUser(session?.user || null);
  };

  const fetchGroups = async () => {
    const { data } = await supabase
      .from('groups')
      .select('*')
      .order('name');
    setGroups(data || []);
  };

  const validateDomain = (domain: string): boolean => {
    // Allow domains with multiple subdomains (e.g., www.info.gouv.fr, subdomain.example.com, example.com)
    // Pattern: one or more subdomain parts followed by a TLD or country code TLD
    const domainRegex = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.([a-zA-Z]{2,}|[a-zA-Z]{2,}\.[a-zA-Z]{2,})$/;
    return domainRegex.test(domain);
  };

  const handleBrandsChange = (value: string) => {
    setFormData({ ...formData, myBrands: value });
    const brands = value.split(',').map(b => b.trim()).filter(Boolean);
    setBrandsList(brands);
  };

  const handleCompetitorsChange = (value: string) => {
    setFormData({ ...formData, competitors: value });
    const competitors = value.split(',').map(c => c.trim()).filter(Boolean);
    setCompetitorsList(competitors);
  };

  const removeBrand = (index: number) => {
    const newBrands = brandsList.filter((_, i) => i !== index);
    setBrandsList(newBrands);
    setFormData({ ...formData, myBrands: newBrands.join(', ') });
  };

  const removeCompetitor = (index: number) => {
    const newCompetitors = competitorsList.filter((_, i) => i !== index);
    setCompetitorsList(newCompetitors);
    setFormData({ ...formData, competitors: newCompetitors.join(', ') });
  };

  const suggestCompetitors = async () => {
    if (!brandsList.length || !formData.domain) return;
    
    setSuggestingCompetitors(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('suggest-competitors', {
        body: {
          domain: formData.domain,
          brands: brandsList,
          industry: formData.name // Use project name as industry context
        }
      });

      if (error) {
        console.error('Error suggesting competitors:', error);
        alert('Failed to get AI suggestions. Please try again.');
        return;
      }

      if (data && Array.isArray(data)) {
        // Add suggested competitors to existing list, avoiding duplicates
        const existingCompetitors = competitorsList.map(c => c.toLowerCase());
        const newCompetitors = data.filter(competitor => 
          !existingCompetitors.includes(competitor.toLowerCase()) &&
          !brandsList.map(b => b.toLowerCase()).includes(competitor.toLowerCase())
        );
        
        if (newCompetitors.length > 0) {
          const updatedCompetitors = [...competitorsList, ...newCompetitors];
          setCompetitorsList(updatedCompetitors);
          setFormData({ ...formData, competitors: updatedCompetitors.join(', ') });
        } else {
          alert('No new competitors found. The AI may have suggested brands you already have listed.');
        }
      }
    } catch (error) {
      console.error('Error calling suggest-competitors function:', error);
      alert('Failed to get AI suggestions. Please try again.');
    }
    
    setSuggestingCompetitors(false);
  };

  const validateForm = () => {
    const newErrors: any = {};
    
    if (!formData.name.trim()) newErrors.name = 'Project name is required';
    if (!formData.domain.trim()) {
      newErrors.domain = 'Domain is required';
    } else if (!validateDomain(formData.domain)) {
      newErrors.domain = 'Please enter a valid domain format (e.g., example.com)';
    }
    if (!formData.country.trim()) newErrors.country = 'Country is required';
    if (!formData.myBrands.trim()) newErrors.myBrands = 'My Brands is required';
    if (!formData.competitors.trim()) newErrors.competitors = 'Competitors is required';
    if (!formData.prompts.trim()) newErrors.prompts = 'Prompts is required';
    
    if (groupMode === 'existing' && !formData.groupId) {
      newErrors.group = 'Please select a group or create a new one';
    }
    if (groupMode === 'new' && !formData.newGroupName.trim()) {
      newErrors.newGroupName = 'Group name is required';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    
    if (!validateForm()) return;

    setLoading(true);

    try {
      let groupId = formData.groupId;

      // Create new group if specified
      if (groupMode === 'new' && formData.newGroupName) {
        const { data: newGroup } = await supabase
          .from('groups')
          .insert({
            name: formData.newGroupName,
            color: formData.newGroupColor,
            created_by: user.id,
          })
          .select()
          .single();
        
        if (newGroup) {
          groupId = newGroup.id;
        }
      }

      // Create project
      const { data: project, error: projectError } = await supabase
        .from('projects')
        .insert({
          name: formData.name,
          group_id: groupId || null,
          domain: formData.domain,
          domain_mode: formData.domainMode,
          country: formData.country,
          created_by: user.id,
        })
        .select()
        .single();

      if (projectError) throw projectError;

      // Add brands
      if (formData.myBrands.trim()) {
        const brands = formData.myBrands.split(',').map(b => b.trim()).filter(Boolean);
        await supabase
          .from('brands')
          .insert(
            brands.map(brand => ({
              project_id: project.id,
              brand_name: brand,
              is_competitor: false,
            }))
          );
      }

      // Add competitors
      if (formData.competitors.trim()) {
        const competitors = formData.competitors.split(',').map(c => c.trim()).filter(Boolean);
        await supabase
          .from('brands')
          .insert(
            competitors.map(competitor => ({
              project_id: project.id,
              brand_name: competitor,
              is_competitor: true,
            }))
          );
      }

      // Add prompts
      if (formData.prompts.trim()) {
        const parsedPrompts = parsePrompts(formData.prompts);
        await supabase
          .from('prompts')
          .insert(
            parsedPrompts.map(prompt => ({
              project_id: project.id,
              prompt_text: prompt.text,
              prompt_group: prompt.group,
            }))
          );
      }

      onSuccess();
      onClose();
      
      // Reset form
      setFormData({
        name: '',
        groupId: '',
        newGroupName: '',
        newGroupColor: '#6366f1',
        domain: '',
        domainMode: 'exact',
        country: 'US',
        myBrands: '',
        competitors: '',
        prompts: '',
        llms: ['searchgpt', 'perplexity', 'gemini'],
      });
      setBrandsList([]);
      setCompetitorsList([]);
      setGroupMode('existing');
      setErrors({});
    } catch (error) {
      console.error('Error creating project:', error);
    }

    setLoading(false);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create New Project" size="lg">
      <form onSubmit={handleSubmit} className="p-6 space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Project Name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            error={errors.name}
            required
          />
          
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Project Group *
            </label>
            <select
              value={groupMode === 'new' ? 'new' : formData.groupId}
              onChange={(e) => {
                if (e.target.value === 'new') {
                  setFormData({ ...formData, groupId: '' });
                  setGroupMode('new');
                } else {
                  setFormData({ ...formData, groupId: e.target.value });
                  setGroupMode('existing');
                }
              }}
              className={`block w-full rounded-2xl border px-4 py-2.5 text-gray-900 dark:text-gray-100 focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 ${
                errors.group ? 'border-red-300' : 'border-gray-300 dark:border-gray-600'
              } bg-white dark:bg-gray-700`}
            >
              <option value="">Select a group</option>
              {groups.map(group => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
              <option value="new">+ Create new group</option>
            </select>
            {errors.group && <p className="text-sm text-red-600 dark:text-red-400 mt-1">{errors.group}</p>}
          </div>
        </div>

        {/* New Group Fields - Show only when creating new group */}
        {groupMode === 'new' && (
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="New Group Name"
              value={formData.newGroupName}
              onChange={(e) => setFormData({ ...formData, newGroupName: e.target.value })}
              placeholder="Enter group name"
              error={errors.newGroupName}
              required
            />
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                Group Color *
              </label>
              <div className="grid grid-cols-5 gap-2">
                {Object.entries(colorPalette).map(([name, color]) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setFormData({ ...formData, newGroupColor: color })}
                    className={`w-8 h-8 rounded-full border-2 transition-all ${
                      formData.newGroupColor === color 
                        ? 'border-gray-800 dark:border-gray-200 scale-110' 
                        : 'border-gray-300 dark:border-gray-600'
                    }`}
                    style={{ backgroundColor: color }}
                    title={name.replace('_', ' ')}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-4">
          <Input
            label="Domain"
            value={formData.domain}
            onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
            placeholder="example.com"
            error={errors.domain}
            required
          />
          
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Domain Mode *
            </label>
            <select
              value={formData.domainMode}
              onChange={(e) => setFormData({ ...formData, domainMode: e.target.value as 'exact' | 'subdomains' })}
              className="block w-full rounded-2xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2.5 text-gray-900 dark:text-gray-100 focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20"
            >
              <option value="exact">Exact</option>
              <option value="subdomains">Include Subdomains</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Country *
            </label>
            <select
              value={formData.country}
              onChange={(e) => setFormData({ ...formData, country: e.target.value })}
              className={`block w-full rounded-2xl border px-4 py-2.5 text-gray-900 dark:text-gray-100 focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 ${
                errors.country ? 'border-red-300' : 'border-gray-300 dark:border-gray-600'
              } bg-white dark:bg-gray-700`}
              required
            >
              <option value="">Select a country</option>
              {countries.slice(0, 6).map((country, index) => (
                <option key={country.code} value={country.code}>
                  {country.name}
                </option>
              ))}
              {countries.length > 6 && (
                <option disabled>──────────</option>
              )}
              {countries.slice(6).map(country => (
                <option key={country.code} value={country.code}>
                  {country.name}
                </option>
              ))}
            </select>
            
            {errors.country && <p className="text-sm text-red-600 dark:text-red-400 mt-1">{errors.country}</p>}
          </div>
        </div>

        <div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              My Brands * (comma-separated)
            </label>
            {brandsList.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {brandsList.map((brand, index) => (
                  <span
                    key={index}
                    className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-brand-primary/10 text-brand-primary border border-brand-primary/20"
                  >
                    {brand}
                    <button
                      type="button"
                      onClick={() => removeBrand(index)}
                      className="ml-2 text-brand-primary/60 hover:text-brand-primary"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <Input
              value={formData.myBrands}
              onChange={(e) => handleBrandsChange(e.target.value)}
              placeholder="Apple, iPhone, MacBook"
              error={errors.myBrands}
              required
            />
          </div>
          
          <div className="mt-4">
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Competitors * (comma-separated)
              </label>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={suggestCompetitors}
                disabled={brandsList.length === 0 || !formData.domain || suggestingCompetitors}
                loading={suggestingCompetitors}
              >
                <Sparkles className="w-4 h-4 mr-1" />
                {suggestingCompetitors ? 'Suggesting...' : 'AI Suggest'}
              </Button>
            </div>
            {competitorsList.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {competitorsList.map((competitor, index) => (
                  <span
                    key={index}
                    className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-700"
                  >
                    {competitor}
                    <button
                      type="button"
                      onClick={() => removeCompetitor(index)}
                      className="ml-2 text-red-500 hover:text-red-700"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <Input
              value={formData.competitors}
              onChange={(e) => handleCompetitorsChange(e.target.value)}
              placeholder="Samsung, Google, Microsoft"
              error={errors.competitors}
              required
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Prompts * (one per line, use "group;prompt" for grouping)
          </label>
          <textarea
            value={formData.prompts}
            onChange={(e) => setFormData({ ...formData, prompts: e.target.value })}
            className={`block w-full rounded-2xl border px-4 py-2.5 text-gray-900 dark:text-gray-100 focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 ${
              errors.prompts ? 'border-red-300' : 'border-gray-300 dark:border-gray-600'
            } bg-white dark:bg-gray-700`}
            rows={6}
            placeholder="Best smartphone 2024&#10;Reviews;iPhone 15 review&#10;Comparison;iPhone vs Samsung"
            required
          />
          {errors.prompts && <p className="text-sm text-red-600 dark:text-red-400 mt-1">{errors.prompts}</p>}
        </div>

        <div className="flex justify-end space-x-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="gradient" type="submit" loading={loading}>
            Create Project
          </Button>
        </div>
      </form>
    </Modal>
  );
};