import React, { useState } from 'react';
import { Clock, Phone, CheckCircle2 } from 'lucide-react';
import { Button, Input, Card, PageHeader } from '../ui';

export const SettingsView: React.FC = () => {
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('18:00');
  const [callerId, setCallerId] = useState('+17372508034');
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const handleSave = () => {
    setSavedMessage('Settings updated successfully.');
    setTimeout(() => setSavedMessage(null), 3000);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Practice Settings"
        description="Configure default calling windows, NZ timezone enforcement, and office caller ID."
        actions={
          <Button variant="primary" size="sm" onClick={handleSave}>
            Save Settings
          </Button>
        }
      />

      {savedMessage && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs px-3.5 py-2 rounded-lg flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{savedMessage}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <Clock className="w-4 h-4 text-[#0f2e4a]" />
            <h3 className="text-sm font-semibold text-slate-900">Calling Window Compliance</h3>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Dialing Window Start (NZST)"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              type="time"
            />
            <Input
              label="Dialing Cutoff (NZST)"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              type="time"
            />
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Outbound dialing is restricted strictly to NZST business hours to comply with New Zealand communications regulations.
          </p>
        </Card>

        <Card className="space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <Phone className="w-4 h-4 text-[#0f2e4a]" />
            <h3 className="text-sm font-semibold text-slate-900">Telephony Configuration</h3>
          </div>

          <Input
            label="Henderson Office Caller ID (E.164)"
            value={callerId}
            onChange={(e) => setCallerId(e.target.value)}
          />
          <Input
            label="Practice Timezone"
            defaultValue="Pacific/Auckland (NZST/NZDT)"
            disabled
          />
        </Card>
      </div>
    </div>
  );
};
