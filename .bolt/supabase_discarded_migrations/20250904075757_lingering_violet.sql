/*
  # Add sentiment analysis fields to llm_responses table

  1. Changes
    - Add `sentiment_score` column to store numeric sentiment score (-1 to 1)
    - Add `sentiment_label` column to store sentiment label (positive, neutral, negative)
    - Add check constraint for sentiment_label values

  2. Security
    - No RLS changes needed as llm_responses table already has proper RLS policies
*/

-- Add sentiment analysis columns to llm_responses table
ALTER TABLE llm_responses 
ADD COLUMN sentiment_score numeric,
ADD COLUMN sentiment_label text;

-- Add constraint for sentiment_label to only allow specific values
ALTER TABLE llm_responses 
ADD CONSTRAINT llm_responses_sentiment_label_check 
CHECK (sentiment_label IN ('positive', 'neutral', 'negative'));

-- Add constraint for sentiment_score to be between -1 and 1
ALTER TABLE llm_responses 
ADD CONSTRAINT llm_responses_sentiment_score_check 
CHECK (sentiment_score >= -1 AND sentiment_score <= 1);