import React, { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api } from '../../services/api';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Lock, CheckCircle2, AlertCircle, KeyRound } from 'lucide-react';

export const ResetPasswordPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const queryToken = searchParams.get('token');
    if (queryToken) {
      setToken(queryToken);
    }
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!token.trim()) {
      setErrorMessage('A valid password reset token is required');
      return;
    }

    if (password.length < 8) {
      setErrorMessage('Password must be at least 8 characters long');
      return;
    }

    if (!/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
      setErrorMessage('Password must include at least one uppercase letter and one number');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match');
      return;
    }

    setIsLoading(true);
    try {
      const res = await api.resetPassword(token.trim(), password);
      if (res.success) {
        setIsSuccess(true);
      } else {
        setErrorMessage(res.error?.message || 'Password reset failed. The token may be expired or invalid.');
      }
    } catch {
      setErrorMessage('Unable to connect to the authentication service.');
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
        <h1 className="text-xl font-bold text-slate-900 tracking-tight">Set New Password</h1>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          Auckland Accounting Services Ltd
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4 sm:px-0">
        <Card className="p-8 shadow-sm">
          {isSuccess ? (
            <div className="space-y-5 text-center">
              <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div className="space-y-2">
                <h2 className="text-sm font-bold text-slate-900">Password Updated Successfully</h2>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Your credentials have been securely updated and all active sessions revoked. You can now sign in with your new password.
                </p>
              </div>
              <div className="pt-2">
                <Link to="/login">
                  <Button variant="primary" size="md" className="w-full">
                    Sign In to ACULA
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="border-b border-slate-100 pb-3">
                <h2 className="text-sm font-bold text-slate-900">Create new password</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Must be at least 8 characters with letters and numbers.
                </p>
              </div>

              {errorMessage && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2.5 text-xs text-red-700">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-600 mt-0.5" />
                  <span>{errorMessage}</span>
                </div>
              )}

              <Input
                label="Reset Token"
                type="text"
                placeholder="Paste token or link code"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                required
                leftIcon={<KeyRound className="w-4 h-4" />}
              />

              <Input
                label="New Password"
                type="password"
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                leftIcon={<Lock className="w-4 h-4" />}
              />

              <Input
                label="Confirm New Password"
                type="password"
                placeholder="••••••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                leftIcon={<Lock className="w-4 h-4" />}
              />

              <Button
                type="submit"
                variant="primary"
                size="md"
                className="w-full mt-2"
                isLoading={isLoading}
              >
                Update Password
              </Button>

              <div className="pt-2 text-center">
                <Link
                  to="/login"
                  className="text-xs font-medium text-slate-600 hover:text-slate-900 hover:underline"
                >
                  Cancel and return to Sign In
                </Link>
              </div>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
};
