import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '../lib/supabase';

interface AuditContextType {
  activeAudits: string[];
  addAudit: (auditId: string) => void;
  removeAudit: (auditId: string) => void;
}

const AuditContext = createContext<AuditContextType | undefined>(undefined);

export const useAudit = () => {
  const context = useContext(AuditContext);
  if (context === undefined) {
    throw new Error('useAudit must be used within an AuditProvider');
  }
  return context;
};

interface AuditProviderProps {
  children: ReactNode;
}

export const AuditProvider: React.FC<AuditProviderProps> = ({ children }) => {
  const [activeAudits, setActiveAudits] = useState<string[]>([]);

  useEffect(() => {
    if (!supabase) return;

    // Load active audits on mount
    loadActiveAudits();

    // Subscribe to audit status changes for current user's audits only
    const setupSubscription = async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) return;

      const auditChannel = supabase
        .channel('audit-status-changes')
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'audits',
            filter: `created_by=eq.${user.user.id}`, // Filter by user
          },
          (payload) => {
            console.log('AuditContext: Audit status change:', payload.new);

            // If audit completed or failed, remove from active list
            if (payload.new.status === 'completed' || payload.new.status === 'failed') {
              setActiveAudits(prev => prev.filter(id => id !== payload.new.id));
            }
            // If audit started running, add to active list
            else if (payload.new.status === 'running' || payload.new.status === 'pending') {
              setActiveAudits(prev => {
                if (!prev.includes(payload.new.id)) {
                  return [...prev, payload.new.id];
                }
                return prev;
              });
            }
          }
        )
        .subscribe();

      return auditChannel;
    };

    let channelPromise = setupSubscription();

    return () => {
      channelPromise.then(channel => {
        if (channel) supabase.removeChannel(channel);
      });
    };
  }, []);

  const loadActiveAudits = async () => {
    try {
      console.log('AuditContext: Loading active audits...');
      
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) return;

      // Get all running or pending audits for user's projects
      const { data: audits, error } = await supabase
        .from('audits')
        .select(`
          id,
          status,
          projects!inner (
            created_by
          )
        `)
        .in('status', ['pending', 'running'])
        .eq('projects.created_by', user.user.id);

      if (error) {
        console.error('AuditContext: Error loading active audits:', error);
        return;
      }

      if (audits && audits.length > 0) {
        const auditIds = audits.map(audit => audit.id);
        console.log('AuditContext: Found active audits:', auditIds);
        setActiveAudits(auditIds);
      } else {
        console.log('AuditContext: No active audits found');
      }
    } catch (error) {
      console.error('AuditContext: Error in loadActiveAudits:', error);
    }
  };

  const addAudit = (auditId: string) => {
    console.log('AuditContext: Adding audit:', auditId);
    setActiveAudits(prev => {
      if (!prev.includes(auditId)) {
        return [...prev, auditId];
      }
      return prev;
    });
  };

  const removeAudit = (auditId: string) => {
    console.log('AuditContext: Removing audit:', auditId);
    setActiveAudits(prev => prev.filter(id => id !== auditId));
  };

  return (
    <AuditContext.Provider value={{ activeAudits, addAudit, removeAudit }}>
      {children}
    </AuditContext.Provider>
  );
};