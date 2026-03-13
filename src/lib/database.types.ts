export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          role: 'admin' | 'manager' | 'client';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          email: string;
          full_name?: string | null;
          role?: 'admin' | 'manager' | 'client';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string | null;
          role?: 'admin' | 'manager' | 'client';
          created_at?: string;
          updated_at?: string;
        };
      };
      groups: {
        Row: {
          id: string;
          name: string;
          color: string;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          color?: string;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          color?: string;
          created_by?: string | null;
          created_at?: string;
        };
      };
      projects: {
        Row: {
          id: string;
          name: string;
          group_id: string | null;
          domain: string;
          domain_mode: 'exact' | 'subdomains';
          country: string;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          group_id?: string | null;
          domain: string;
          domain_mode?: 'exact' | 'subdomains';
          country?: string;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          group_id?: string | null;
          domain?: string;
          domain_mode?: 'exact' | 'subdomains';
          country?: string;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      project_members: {
        Row: {
          id: string;
          project_id: string;
          user_id: string;
          role: 'admin' | 'manager' | 'client';
          created_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          user_id: string;
          role?: 'admin' | 'manager' | 'client';
          created_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          user_id?: string;
          role?: 'admin' | 'manager' | 'client';
          created_at?: string;
        };
      };
      brands: {
        Row: {
          id: string;
          project_id: string;
          brand_name: string;
          is_competitor: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          brand_name: string;
          is_competitor?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          brand_name?: string;
          is_competitor?: boolean;
          created_at?: string;
        };
      };
      prompts: {
        Row: {
          id: string;
          project_id: string;
          prompt_text: string;
          prompt_group: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          prompt_text: string;
          prompt_group?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          prompt_text?: string;
          prompt_group?: string;
          created_at?: string;
        };
      };
      audits: {
        Row: {
          id: string;
          project_id: string;
          llms: string[];
          run_by: string | null;
          sentiment: boolean;
          status: 'pending' | 'running' | 'completed' | 'failed';
          progress: number;
          started_at: string | null;
          finished_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          llms: string[];
          run_by?: string | null;
          sentiment?: boolean;
          status?: 'pending' | 'running' | 'completed' | 'failed';
          progress?: number;
          started_at?: string | null;
          finished_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          llms?: string[];
          run_by?: string | null;
          sentiment?: boolean;
          status?: 'pending' | 'running' | 'completed' | 'failed';
          progress?: number;
          started_at?: string | null;
          finished_at?: string | null;
          created_at?: string;
        };
      };
      audit_steps: {
        Row: {
          id: string;
          audit_id: string;
          step: 'fetch' | 'parse' | 'sentiment' | 'persist';
          status: 'pending' | 'running' | 'done' | 'error';
          message: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          audit_id: string;
          step: 'fetch' | 'parse' | 'sentiment' | 'persist';
          status?: 'pending' | 'running' | 'done' | 'error';
          message?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          audit_id?: string;
          step?: 'fetch' | 'parse' | 'sentiment' | 'persist';
          status?: 'pending' | 'running' | 'done' | 'error';
          message?: string | null;
          created_at?: string;
        };
      };
      citations: {
        Row: {
          id: string;
          audit_id: string;
          prompt_id: string | null;
          llm: 'searchgpt' | 'perplexity' | 'gemini';
          page_url: string | null;
          domain: string | null;
          citation_text: string | null;
          position: number | null;
          sentiment_score: number | null;
          sentiment_label: 'positive' | 'neutral' | 'negative' | null;
          cited: boolean | null;
          checked_at: string;
        };
        Insert: {
          id?: string;
          audit_id: string;
          prompt_id?: string | null;
          llm: 'searchgpt' | 'perplexity' | 'gemini';
          page_url?: string | null;
          domain?: string | null;
          citation_text?: string | null;
          position?: number | null;
          sentiment_score?: number | null;
          sentiment_label?: 'positive' | 'neutral' | 'negative' | null;
          cited?: boolean | null;
          checked_at?: string;
        };
        Update: {
          id?: string;
          audit_id?: string;
          prompt_id?: string | null;
          llm?: 'searchgpt' | 'perplexity' | 'gemini';
          page_url?: string | null;
          domain?: string | null;
          citation_text?: string | null;
          position?: number | null;
          sentiment_score?: number | null;
          sentiment_label?: 'positive' | 'neutral' | 'negative' | null;
          cited?: boolean | null;
          checked_at?: string;
        };
      };
      events: {
        Row: {
          id: string;
          user_id: string | null;
          audit_id: string | null;
          event_type: string;
          message: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          audit_id?: string | null;
          event_type: string;
          message?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          audit_id?: string | null;
          event_type?: string;
          message?: string | null;
          created_at?: string;
        };
      };
      llm_responses: {
        Row: {
          id: string;
          audit_id: string | null;
          prompt_id: string | null;
          llm: 'searchgpt' | 'perplexity' | 'gemini';
          snapshot_id: string | null;
          response_url: string | null;
          answer_text: string | null;
          answer_text_markdown: string | null;
          answer_html: string | null;
          answer_competitors: any | null;
          response_timestamp: string | null;
          country: string;
          raw_response_data: any | null;
          created_at: string;
          sentiment_score: number | null;
          sentiment_label: 'positive' | 'neutral' | 'negative' | null;
          citations: any | null;
          web_search_query: string | null;
          links_attached: any | null;
          search_sources: any | null;
          is_map: boolean | null;
          shopping: any | null;
          shopping_visible: boolean | null;
          organic_results: any | null;
        };
        Insert: {
          id?: string;
          audit_id?: string | null;
          prompt_id?: string | null;
          llm: 'searchgpt' | 'perplexity' | 'gemini';
          snapshot_id?: string | null;
          response_url?: string | null;
          answer_text?: string | null;
          answer_text_markdown?: string | null;
          answer_html?: string | null;
          answer_competitors?: any | null;
          response_timestamp?: string | null;
          country?: string;
          raw_response_data?: any | null;
          created_at?: string;
          sentiment_score?: number | null;
          sentiment_label?: 'positive' | 'neutral' | 'negative' | null;
          citations?: any | null;
          web_search_query?: string | null;
          links_attached?: any | null;
          search_sources?: any | null;
          is_map?: boolean | null;
          shopping?: any | null;
          shopping_visible?: boolean | null;
          organic_results?: any | null;
        };
        Update: {
          id?: string;
          audit_id?: string | null;
          prompt_id?: string | null;
          llm?: 'searchgpt' | 'perplexity' | 'gemini';
          snapshot_id?: string | null;
          response_url?: string | null;
          answer_text?: string | null;
          answer_text_markdown?: string | null;
          answer_html?: string | null;
          answer_competitors?: any | null;
          response_timestamp?: string | null;
          country?: string;
          raw_response_data?: any | null;
          created_at?: string;
          sentiment_score?: number | null;
          sentiment_label?: 'positive' | 'neutral' | 'negative' | null;
          citations?: any | null;
          web_search_query?: string | null;
          links_attached?: any | null;
          search_sources?: any | null;
          is_map?: boolean | null;
          shopping?: any | null;
          shopping_visible?: boolean | null;
          organic_results?: any | null;
        };
      };
    };
  };
};