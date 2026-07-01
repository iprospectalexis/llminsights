import React, { useEffect, useState } from 'react';
import { X, Sparkles, CheckCircle2, Loader2 } from 'lucide-react';
import { submitGeoLead } from '../lib/backendApi';

const FIELD =
  'block w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 ' +
  'px-3.5 py-2.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 ' +
  'focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 focus:outline-none transition-colors';
const LABEL = 'block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1';

const DEFAULT_MESSAGE = 'Je souhaite savoir plus sur votre offre GEO.';
const IP_LOGO_URL =
  'https://iprospect-fr.com/hs-fs/hubfs/iP_Logo_Carbon_dentsu-3.png?width=161&height=41&name=iP_Logo_Carbon_dentsu-3.png';

/**
 * Modale "Votre stratégie GEO" : formulaire de contact / lead. Les envois
 * partent vers l'endpoint backend /v1/serp/lead (qui les e-maile à l'équipe).
 */
export const GeoStrategyModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [status, setStatus] = useState<'idle' | 'sending' | 'ok' | 'error'>('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!firstName.trim() || !lastName.trim() || !email.trim()) {
      setError('Merci de renseigner votre prénom, nom et e-mail.');
      return;
    }
    setStatus('sending');
    try {
      await submitGeoLead({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        message: message.trim() || DEFAULT_MESSAGE,
      });
      setStatus('ok');
    } catch {
      setStatus('error');
      setError("L'envoi a échoué. Réessayez dans un instant.");
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-lg rounded-3xl bg-white dark:bg-gray-800 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer"
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="px-7 pt-7 pb-6">
          <img
            src={IP_LOGO_URL}
            alt="iProspect"
            className="mb-5 h-7 w-auto dark:brightness-0 dark:invert"
          />
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-primary/10 text-brand-primary px-3 py-1 text-xs font-semibold">
            <Sparkles className="w-3.5 h-3.5" /> GEO
          </span>
          <h2 className="mt-3 text-xl font-bold text-gray-900 dark:text-white">Votre stratégie GEO</h2>
          <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">
            État des lieux de votre visibilité dans les moteurs IA et recommandations GEO actionnables.
          </p>

          {status === 'ok' ? (
            <div className="mt-8 mb-4 flex flex-col items-center gap-3 text-center">
              <CheckCircle2 className="w-12 h-12 text-green-500" />
              <p className="text-base font-semibold text-gray-900 dark:text-white">Merci, c'est envoyé !</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Nous revenons vers vous très rapidement au sujet de votre stratégie GEO.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="mt-2 rounded-xl bg-brand-primary px-5 py-2 text-sm font-medium text-white hover:bg-brand-primary/90 transition-colors"
              >
                Fermer
              </button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="mt-5 space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className={LABEL}>Prénom</label>
                  <input
                    className={FIELD}
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Prénom"
                    autoComplete="given-name"
                  />
                </div>
                <div>
                  <label className={LABEL}>Nom</label>
                  <input
                    className={FIELD}
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Nom"
                    autoComplete="family-name"
                  />
                </div>
              </div>
              <div>
                <label className={LABEL}>Votre e-mail</label>
                <input
                  type="email"
                  className={FIELD}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="vous@entreprise.com"
                  autoComplete="email"
                />
              </div>
              <div>
                <label className={LABEL}>Votre numéro de téléphone</label>
                <input
                  type="tel"
                  className={FIELD}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+33 6 12 34 56 78"
                  autoComplete="tel"
                />
              </div>
              <div>
                <label className={LABEL}>Votre message</label>
                <textarea
                  className={`${FIELD} resize-none`}
                  rows={3}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </div>

              {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

              <button
                type="submit"
                disabled={status === 'sending'}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-primary to-fuchsia-500 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {status === 'sending' ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Envoi…
                  </>
                ) : (
                  'Demander ma stratégie GEO'
                )}
              </button>
              <p className="text-center text-[11px] text-gray-400">
                En envoyant ce formulaire, vous acceptez d'être recontacté au sujet de votre stratégie GEO.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default GeoStrategyModal;
