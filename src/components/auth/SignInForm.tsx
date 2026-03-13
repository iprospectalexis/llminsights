import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Card, CardContent } from '../ui/Card';
import { Brain, Mail, Lock, Heart } from 'lucide-react';
import { motion } from 'framer-motion';

export const SignInForm: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        setError(signInError.message);
      } else {
        navigate('/projects');
      }
    } catch (error: any) {
      setError(error.message);
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-brand-primary/5 to-brand-secondary/5 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800 p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl mb-4">
            <img 
              src="https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/llminsights_72.png" 
              alt="LLM Insights Logo" 
              className="w-10 h-10"
            />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Welcome to LLM Insights
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-2">
            Track your brand visibility across AI platforms
          </p>
          
          {/* LLM Icons */}
          <div className="flex items-center justify-center space-x-4 mt-4">
            <img 
              src="https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/SearchGPT.PNG" 
              alt="SearchGPT"
              className="w-8 h-8 object-contain opacity-70"
            />
            <img 
              src="https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Perplexity.png" 
              alt="Perplexity"
              className="w-8 h-8 object-contain opacity-70"
            />
            <img 
              src="https://raw.githubusercontent.com/Fruall/ip_llminsights/refs/heads/main/Gemini.png" 
              alt="Gemini"
              className="w-8 h-8 object-contain opacity-70"
            />
          </div>
        </div>

        <Card>
          <CardContent className="p-6 pt-6 p-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                type="email"
                label="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                icon={<Mail className="w-5 h-5" />}
                required
              />
              
              <Input
                type="password"
                label="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                icon={<Lock className="w-5 h-5" />}
                required
              />

              {error && (
                <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-3 rounded-xl">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                variant="gradient"
                className="w-full"
                loading={loading}
              >
                Sign In
              </Button>
            </form>

            <div className="mt-6 text-center">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Don't have an account?{' '}
                <Link 
                  to="/signup" 
                  className="text-brand-primary hover:text-brand-primary/80 font-medium"
                >
                  Sign up
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Copyright */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="mt-8 text-center"
        >
          <p className="text-sm text-gray-600 dark:text-gray-400 flex items-center justify-center gap-1">
            Made with <Brain className="w-4 h-4 text-brand-primary" /> & <Heart className="w-4 h-4 text-red-500" /> by One Search Team at iProspect France
          </p>
        </motion.div>
      </motion.div>
    </div>
  );
};