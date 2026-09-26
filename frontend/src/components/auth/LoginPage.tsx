import React, { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { AlertCircle, Lock, Mail, ShieldCheck } from 'lucide-react';

export const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/dashboard';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!email.trim() || !password) {
      setErrorMessage('Please enter your email and password');
      return;
    }

    setIsLoading(true);
    try {
      const res = await login(email, password);
      if (res.success) {
        navigate(from, { replace: true });
      } else {
        setErrorMessage(res.error?.message || 'Authentication failed. Please check your credentials.');
      }
    } catch {
      setErrorMessage('Unable to connect to the authentication service. Please check your network.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickFill = (demoEmail: string, demoPass: string) => {
    setEmail(demoEmail);
    setPassword(demoPass);
    setErrorMessage(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      {/* Brand Header */}
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center space-y-2">
        <div className="w-12 h-12 rounded-xl bg-[#0f2e4a] text-white flex items-center justify-center font-bold text-lg mx-auto shadow-sm">
          AK
        </div>
        <h1 className="text-xl font-bold text-slate-900 tracking-tight">Auckland Accounting Services Ltd</h1>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          ACULA — Automated Outbound Calling & IVR Platform
        </p>
      </div>

      {/* Main Login Card */}
      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4 sm:px-0">
        <Card className="p-8 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="border-b border-slate-100 pb-3">
              <h2 className="text-sm font-bold text-slate-900">Sign in to your account</h2>
              <p className="text-xs text-slate-500 mt-0.5">Enter your practice credentials to access operations</p>
            </div>

            {errorMessage && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2.5 text-xs text-red-700">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-600 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            <Input
              label="Email Address"
              type="email"
              placeholder="user@aucklandaccounting.co.nz"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              leftIcon={<Mail className="w-4 h-4" />}
            />

            <Input
              label="Password"
              type="password"
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              leftIcon={<Lock className="w-4 h-4" />}
            />

            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center">
                <input
                  id="remember-me"
                  name="remember-me"
                  type="checkbox"
                  defaultChecked
                  className="h-4 w-4 rounded border-slate-300 text-[#0f2e4a] focus:ring-[#0f2e4a]"
                />
                <label htmlFor="remember-me" className="ml-2 block text-xs text-slate-600">
                  Keep session active
                </label>
              </div>

              <Link
                to="/forgot-password"
                className="text-xs font-medium text-[#0f2e4a] hover:text-slate-800 hover:underline"
              >
                Forgot password?
              </Link>
            </div>

            <Button
              type="submit"
              variant="primary"
              size="md"
              className="w-full mt-2"
              isLoading={isLoading}
            >
              Sign In to ACULA
            </Button>
          </form>

          {/* Practice Credentials 1-Click Quick-Fill */}
          {import.meta.env.VITE_HIDE_DEMO_CREDENTIALS !== 'true' && (
            <div className="mt-6 pt-5 border-t border-slate-100">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2.5">
                <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
                <span>Practice Staff Credentials (1-Click Login)</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => handleQuickFill('superadmin@aucklandaccounting.co.nz', 'AculaSuperAdmin2026!')}
                  className="p-2 text-center rounded-lg border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-[11px] text-slate-700 font-medium transition-colors cursor-pointer"
                >
                  <div className="font-bold text-slate-900">Super Admin</div>
                  <div className="text-[10px] text-slate-400">David Chen</div>
                </button>

                <button
                  type="button"
                  onClick={() => handleQuickFill('admin@aucklandaccounting.co.nz', 'AculaAdmin2026!')}
                  className="p-2 text-center rounded-lg border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-[11px] text-slate-700 font-medium transition-colors cursor-pointer"
                >
                  <div className="font-bold text-slate-900">Admin</div>
                  <div className="text-[10px] text-slate-400">Priya Sharma</div>
                </button>

                <button
                  type="button"
                  onClick={() => handleQuickFill('operator@aucklandaccounting.co.nz', 'AculaOperator2026!')}
                  className="p-2 text-center rounded-lg border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-[11px] text-slate-700 font-medium transition-colors cursor-pointer"
                >
                  <div className="font-bold text-slate-900">Operator</div>
                  <div className="text-[10px] text-slate-400">James Wilson</div>
                </button>
              </div>
            </div>
          )}
        </Card>

        {/* Security Notice */}
        <p className="mt-4 text-center text-[11px] text-slate-400">
          Henderson Office Practice Server • Authenticated Encrypted Session
        </p>
      </div>
    </div>
  );
};
