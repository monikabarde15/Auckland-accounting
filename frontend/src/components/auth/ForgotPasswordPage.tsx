import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Mail, ArrowLeft, CheckCircle2 } from 'lucide-react';

export const ForgotPasswordPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [devToken, setDevToken] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setIsLoading(true);
    try {
      const res = await api.forgotPassword(email);
      setIsSubmitted(true);
      if (res.data?.developmentToken) {
        setDevToken(res.data.developmentToken);
      }
    } catch {
      setIsSubmitted(true);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center space-y-2">
        <div className="w-12 h-12 rounded-xl bg-[#0f2e4a] text-white flex items-center justify-center font-bold text-lg mx-auto shadow-sm">
          AK
        </div>
        <h1 className="text-xl font-bold text-slate-900 tracking-tight">Password Recovery</h1>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          Auckland Accounting Services Ltd
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4 sm:px-0">
        <Card className="p-8 shadow-sm">
          {isSubmitted ? (
            <div className="space-y-5 text-center">
              <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div className="space-y-2">
                <h2 className="text-sm font-bold text-slate-900">Recovery Instructions Dispatched</h2>
                <p className="text-xs text-slate-600 leading-relaxed">
                  If an active practice account exists with the address{' '}
                  <span className="font-semibold text-slate-800">{email}</span>, a single-use password reset link has been issued.
                </p>
              </div>

              {devToken && (
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-left space-y-2">
                  <div className="text-[10px] uppercase font-bold text-slate-400">Development Test Token</div>
                  <div className="text-xs font-mono bg-white p-2 rounded border border-slate-200 break-all select-all">
                    {devToken}
                  </div>
                  <Link
                    to={`/reset-password?token=${devToken}`}
                    className="block text-center text-xs font-semibold text-[#0f2e4a] hover:underline"
                  >
                    Proceed to Reset Password →
                  </Link>
                </div>
              )}

              <div className="pt-2">
                <Link to="/login">
                  <Button variant="outline" size="sm" className="w-full">
                    Return to Sign In
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="border-b border-slate-100 pb-3">
                <h2 className="text-sm font-bold text-slate-900">Reset your practice password</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Enter your verified email address to receive a secure recovery link.
                </p>
              </div>

              <Input
                label="Registered Email Address"
                type="email"
                placeholder="user@aucklandaccounting.co.nz"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                leftIcon={<Mail className="w-4 h-4" />}
              />

              <Button
                type="submit"
                variant="primary"
                size="md"
                className="w-full mt-2"
                isLoading={isLoading}
              >
                Send Recovery Instructions
              </Button>

              <div className="pt-2 text-center">
                <Link
                  to="/login"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back to Sign In</span>
                </Link>
              </div>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
};
