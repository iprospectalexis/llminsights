#!/usr/bin/env node

/**
 * Test Script for Scheduled Audits
 *
 * This script safely triggers scheduled audits by:
 * 1. Checking for running audits per project
 * 2. Only updating projects that don't have active audits
 * 3. Triggering the scheduler
 * 4. Showing status of what happened
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing environment variables. Check your .env file.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function testScheduledAudits() {
  console.log('🔍 Checking scheduled audit projects...\n');

  // Get all projects with scheduled audits enabled
  const { data: projects, error: projectsError } = await supabase
    .from('projects')
    .select('id, name, scheduled_audits_enabled, next_scheduled_audit_at')
    .eq('scheduled_audits_enabled', true)
    .order('name');

  if (projectsError) {
    console.error('❌ Error fetching projects:', projectsError);
    return;
  }

  if (!projects || projects.length === 0) {
    console.log('⚠️  No projects with scheduled audits enabled.');
    return;
  }

  console.log(`Found ${projects.length} project(s) with scheduled audits:\n`);

  // Check for running/pending audits for each project
  const projectsToUpdate = [];
  const projectsWithActiveAudits = [];

  for (const project of projects) {
    const { data: activeAudits, error: auditError } = await supabase
      .from('audits')
      .select('id, status, created_at')
      .eq('project_id', project.id)
      .in('status', ['running', 'pending'])
      .order('created_at', { ascending: false })
      .limit(1);

    if (auditError) {
      console.error(`❌ Error checking audits for ${project.name}:`, auditError);
      continue;
    }

    if (activeAudits && activeAudits.length > 0) {
      projectsWithActiveAudits.push({
        ...project,
        activeAudit: activeAudits[0]
      });
      console.log(`⏳ ${project.name} - Has ${activeAudits[0].status} audit (skipping)`);
    } else {
      projectsToUpdate.push(project);
      console.log(`✅ ${project.name} - Ready for scheduling`);
    }
  }

  console.log('\n' + '='.repeat(60) + '\n');

  if (projectsToUpdate.length === 0) {
    console.log('⚠️  No projects available for scheduling (all have active audits).');
    console.log('   Wait for running audits to complete first.\n');
    return;
  }

  console.log(`📅 Scheduling ${projectsToUpdate.length} project(s)...\n`);

  // Update next_scheduled_audit_at to trigger immediate scheduling
  const { error: updateError } = await supabase
    .from('projects')
    .update({ next_scheduled_audit_at: new Date(Date.now() - 5 * 60 * 1000).toISOString() })
    .in('id', projectsToUpdate.map(p => p.id));

  if (updateError) {
    console.error('❌ Error updating projects:', updateError);
    return;
  }

  console.log('✅ Updated next_scheduled_audit_at for eligible projects\n');

  // Trigger the scheduler
  console.log('🚀 Triggering scheduler...\n');

  const response = await fetch(`${supabaseUrl}/functions/v1/process-scheduled-audits`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${supabaseServiceKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('❌ Scheduler error:', error);
    return;
  }

  const result = await response.json();
  console.log('✅ Scheduler completed:\n');
  console.log(`   Created: ${result.created_count} audit(s)`);
  console.log(`   Skipped: ${result.skipped_count} project(s)`);

  if (result.errors && result.errors.length > 0) {
    console.log('\n⚠️  Errors:');
    result.errors.forEach(err => {
      console.log(`   - ${err.project}: ${err.error}`);
    });
  }

  console.log('\n' + '='.repeat(60) + '\n');
  console.log('✅ Test completed successfully!\n');
}

// Run the test
testScheduledAudits().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});
