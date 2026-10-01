import React, { useState, useEffect, useRef } from 'react';
import {
  Phone,
  PhoneOff,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Play,
  RotateCcw,
  Clock,
  User,
  Headphones,
  Layers,
  ChevronDown,
  Hash
} from 'lucide-react';
import { Questionnaire, Question, Contact, Campaign, CallLog, CallResponseRecord, CallStatus } from '../types';
import { phoneAudio } from '../utils/audio';
import { speechService, createSpeechRecognizer, AVAILABLE_VOICE_PROFILES } from '../utils/speech';
import { Button, Badge, Modal } from './ui';

interface CallSimulatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  questionnaires?: Questionnaire[];
  contacts?: Contact[];
  campaigns?: Campaign[];
  defaultCampaignId?: string;
  defaultQuestionnaireId?: string;
  defaultContactId?: string;
  onSaveCallLog?: (callLog: CallLog) => void;
  questionnaire?: Questionnaire;
  contact?: Contact;
  callerId?: string;
  onCallCompleted?: (callLog: CallLog) => void;
}

export const CallSimulatorModal: React.FC<CallSimulatorModalProps> = ({
  isOpen,
  onClose,
  questionnaires = [],
  contacts = [],
  campaigns = [],
  defaultCampaignId,
  defaultQuestionnaireId,
  defaultContactId,
  onSaveCallLog,
  questionnaire,
  contact,
  onCallCompleted
}) => {
  const allQuestionnaires = (questionnaires && questionnaires.length > 0)
    ? questionnaires
    : (questionnaire ? [questionnaire] : []);
  const allContacts = (contacts && contacts.length > 0)
    ? contacts
    : (contact ? [contact] : []);
  const allCampaigns = campaigns || [];

  const initialCampaignId = defaultCampaignId || (allCampaigns.length > 0 ? allCampaigns[0].id : '');
  const initialQuestionnaireId = defaultQuestionnaireId || questionnaire?.id || (allQuestionnaires.length > 0 ? allQuestionnaires[0].id : '');
  const initialContactId = defaultContactId || contact?.id || (allContacts.length > 0 ? allContacts[0].id : '');

  const [selectedCampaignId, setSelectedCampaignId] = useState<string>(() => initialCampaignId);
  const [selectedQuestionnaireId, setSelectedQuestionnaireId] = useState<string>(() => initialQuestionnaireId);
  const [selectedContactId, setSelectedContactId] = useState<string>(() => initialContactId);

  // Voice Engine State
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>('aria-nz');
  const [isPlayingVoiceSample, setIsPlayingVoiceSample] = useState<boolean>(false);
  const [showFullKeypad, setShowFullKeypad] = useState<boolean>(false);

  // Phone Call State Machine
  const [callState, setCallState] = useState<'idle' | 'dialing' | 'ringing' | 'connected' | 'ended'>('idle');
  const [callDuration, setCallDuration] = useState<number>(0);
  const [dialpadInput, setDialpadInput] = useState<string>('');
  const [currentQuestionId, setCurrentQuestionId] = useState<string | null>(null);
  const [questionRetries, setQuestionRetries] = useState<number>(0);
  const [isAudioEnabled, setIsAudioEnabled] = useState<boolean>(true);
  const [isMicListening, setIsMicListening] = useState<boolean>(false);
  const [isTtsSpeaking, setIsTtsSpeaking] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('Ready to test outbound call');
  const [transcript, setTranscript] = useState<Array<{ speaker: 'system' | 'user'; text: string; timestamp: string }>>([]);
  const [responses, setResponses] = useState<CallResponseRecord[]>([]);

  const timerRef = useRef<number | null>(null);
  const recognizerRef = useRef<ReturnType<typeof createSpeechRecognizer> | null>(null);
  const questionTimeoutRef = useRef<number | null>(null);

  const selectedQuestionnaire = allQuestionnaires.find((q) => q.id === selectedQuestionnaireId) || allQuestionnaires[0];
  const selectedContact = allContacts.find((c) => c.id === selectedContactId) || allContacts[0];
  const activeCampaign = allCampaigns.find((c) => c.id === selectedCampaignId);

  useEffect(() => {
    if (defaultCampaignId) setSelectedCampaignId(defaultCampaignId);
    const qId = defaultQuestionnaireId || questionnaire?.id;
    if (qId) setSelectedQuestionnaireId(qId);
    const cId = defaultContactId || contact?.id;
    if (cId) setSelectedContactId(cId);
  }, [defaultCampaignId, defaultQuestionnaireId, questionnaire, defaultContactId, contact]);

  const handleCampaignChange = (campId: string) => {
    setSelectedCampaignId(campId);
    const camp = allCampaigns.find((c) => c.id === campId);
    if (camp?.questionnaireId) {
      setSelectedQuestionnaireId(camp.questionnaireId);
    }
  };

  useEffect(() => {
    if (callState === 'connected') {
      timerRef.current = window.setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [callState]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getNowTimeString = () => {
    const d = new Date();
    return d.toTimeString().split(' ')[0];
  };

  const substituteVariables = (text: string): string => {
    if (!selectedContact) return text;
    const balanceStr = `$${selectedContact.outstandingBalance ? Number(selectedContact.outstandingBalance).toFixed(2) : '0.00'}`;
    return text
      .replace(/\{client_name\}/g, selectedContact.name)
      .replace(/\{company_name\}/g, selectedContact.companyName || '')
      .replace(/\{due_date\}/g, selectedContact.dueDate || 'the 28th')
      .replace(/\{email\}/g, selectedContact.email || '')
      .replace(/\{outstanding_balance\}/g, balanceStr)
      .replace(/\{balance\}/g, balanceStr)
      .replace(/\{ird_number\}/g, selectedContact.irdNumber || '123-456-789')
      .replace(/\{entity_type\}/g, selectedContact.entityType || 'Company')
      .replace(/\{assigned_accountant\}/g, selectedContact.assignedAccountant || 'David Chen (CA)');
  };

  const currentQuestion: Question | undefined = selectedQuestionnaire?.questions.find(
    (q) => q.id === currentQuestionId
  );

  const handlePlayVoiceSample = async () => {
    if (isPlayingVoiceSample) {
      speechService.stop();
      setIsPlayingVoiceSample(false);
      return;
    }
    setIsPlayingVoiceSample(true);
    await speechService.playVoiceSample(selectedVoiceId);
    setIsPlayingVoiceSample(false);
  };

  const startCall = () => {
    if (!selectedQuestionnaire) return;
    setCallDuration(0);
    setTranscript([]);
    setResponses([]);
    setDialpadInput('');
    setCallState('dialing');
    setStatusMessage(`Dialing to ${selectedContact?.phoneNumber || '+64 21 892 4101'}...`);

    phoneAudio.playDtmfTone('1', 90);

    setTimeout(() => {
      setCallState('ringing');
      setStatusMessage(`Ringing client subscriber line (${selectedContact?.phoneNumber || '+64 21 892 4101'})...`);
      phoneAudio.startRingbackTone();

      setTimeout(() => {
        phoneAudio.stopRingtone();
        phoneAudio.playCallConnectedChime();
        setCallState('connected');
        setStatusMessage('Call connected. Audio stream active.');

        const startQId = selectedQuestionnaire.startingQuestionId || selectedQuestionnaire.questions[0]?.id;
        transitionToQuestion(startQId);
      }, 2000);
    }, 1000);
  };

  const transitionToQuestion = (qId: string | 'END' | 'REPEAT' | undefined) => {
    if (questionTimeoutRef.current) {
      clearTimeout(questionTimeoutRef.current);
    }

    if (!qId || qId === 'END') {
      endCall('completed', 'IVR questionnaire completed successfully.');
      return;
    }

    const targetId = qId === 'REPEAT' ? (currentQuestionId || selectedQuestionnaire?.startingQuestionId || selectedQuestionnaire?.questions[0]?.id) : qId;
    const question = selectedQuestionnaire?.questions.find((q) => q.id === targetId);
    if (!question) {
      endCall('completed', 'Flow reached terminal step.');
      return;
    }

    setCurrentQuestionId(targetId || null);
    setQuestionRetries(0);
    setDialpadInput('');

    const promptWithVars = substituteVariables(question.promptText);

    setTranscript((prev) => [
      ...prev,
      { speaker: 'system', text: promptWithVars, timestamp: getNowTimeString() }
    ]);

    setStatusMessage(`Awaiting input for: ${question.name}`);

    if (isAudioEnabled) {
      setIsTtsSpeaking(true);
      speechService.speak(promptWithVars, {
        voiceProfileId: selectedVoiceId,
        audioUrl: question.speechAudioUrl,
        rate: 0.95,
        pitch: 1.01,
        onEnd: () => {
          setIsTtsSpeaking(false);
          if (question.type === 'message_only') {
            setTimeout(() => {
              transitionToQuestion(question.defaultNextQuestionId || 'END');
            }, 1200);
          } else if (question.type === 'transfer') {
            setStatusMessage(question.transferPhoneNumber ? `Transferring call to (${question.transferPhoneNumber})` : 'Transferring call to assigned accountant');
            setTimeout(() => {
              endCall('transferred', 'Call bridged to senior tax advisory queue.');
            }, 2500);
          } else {
            startQuestionTimeoutTimer(question);
          }
        }
      });
    } else {
      if (question.type === 'message_only') {
        setTimeout(() => {
          transitionToQuestion(question.defaultNextQuestionId || 'END');
        }, 1500);
      } else if (question.type === 'transfer') {
        setTimeout(() => {
          endCall('transferred', 'Call bridged to senior tax advisory queue.');
        }, 2500);
      } else {
        startQuestionTimeoutTimer(question);
      }
    }
  };

  const startQuestionTimeoutTimer = (question: Question) => {
    const timeoutSec = question.timeoutSeconds || 8;
    questionTimeoutRef.current = window.setTimeout(() => {
      handleQuestionTimeout(question);
    }, timeoutSec * 1000);
  };

  const handleQuestionTimeout = (question: Question) => {
    const maxRetries = question.maxRetries || 2;
    if (questionRetries < maxRetries) {
      setQuestionRetries((prev) => prev + 1);
      const retryText =
        question.retryPromptText ||
        'We did not receive your response. Please enter your selection on your phone keypad.';
      
      const retryWithVars = substituteVariables(retryText);

      setTranscript((prev) => [
        ...prev,
        {
          speaker: 'system',
          text: `[Timeout retry ${questionRetries + 1}/${maxRetries}]: ${retryWithVars}`,
          timestamp: getNowTimeString()
        }
      ]);

      if (isAudioEnabled) {
        setIsTtsSpeaking(true);
        speechService.speak(retryWithVars, {
          voiceProfileId: selectedVoiceId,
          rate: 0.95,
          pitch: 1.01,
          onEnd: () => {
            setIsTtsSpeaking(false);
            startQuestionTimeoutTimer(question);
          }
        });
      } else {
        startQuestionTimeoutTimer(question);
      }
    } else {
      setTranscript((prev) => [
        ...prev,
        {
          speaker: 'system',
          text: '[Maximum retries exceeded. Terminating session.]',
          timestamp: getNowTimeString()
        }
      ]);
      endCall('no_answer', 'Caller did not respond to prompts.');
    }
  };

  const processInput = (input: string, method: 'dtmf' | 'voice') => {
    if (callState !== 'connected' || !currentQuestion) return;

    if (questionTimeoutRef.current) {
      clearTimeout(questionTimeoutRef.current);
    }

    if (isTtsSpeaking) {
      speechService.stop();
      setIsTtsSpeaking(false);
    }

    if (method === 'dtmf') {
      phoneAudio.playDtmfTone(input, 100);
    }

    setTranscript((prev) => [
      ...prev,
      {
        speaker: 'user',
        text: method === 'dtmf' ? `[Keypad Press: "${input}"]` : `[Voice Spoken: "${input}"]`,
        timestamp: getNowTimeString()
      }
    ]);

    switch (currentQuestion.type) {
      case 'yes_no':
      case 'multiple_choice': {
        const selectedOpt = currentQuestion.options.find((opt) => {
          if (method === 'dtmf') {
            return opt.dtmfDigit === input;
          } else {
            const lowerInput = input.toLowerCase();
            return opt.voiceTriggers?.some((trigger) => lowerInput.includes(trigger.toLowerCase()));
          }
        });

        if (selectedOpt) {
          const record: CallResponseRecord = {
            questionId: currentQuestion.id,
            questionName: currentQuestion.name,
            questionType: currentQuestion.type,
            promptText: currentQuestion.promptText,
            inputReceived: selectedOpt.label,
            inputMethod: method,
            recordedAt: new Date().toISOString(),
            isValid: true
          };
          setResponses((prev) => [...prev, record]);

          const targetNextId = selectedOpt.nextQuestionId || currentQuestion.defaultNextQuestionId || 'END';
          transitionToQuestion(targetNextId);
        } else {
          handleInvalidInput(input);
        }
        break;
      }

      case 'rating_1_5': {
        const num = parseInt(input.trim(), 10);
        if (!isNaN(num) && num >= 1 && num <= 5) {
          const matchedOpt = currentQuestion.options.find((opt) => opt.dtmfDigit === num.toString());
          const record: CallResponseRecord = {
            questionId: currentQuestion.id,
            questionName: currentQuestion.name,
            questionType: currentQuestion.type,
            promptText: currentQuestion.promptText,
            inputReceived: matchedOpt ? matchedOpt.label : `${num} out of 5`,
            inputMethod: method,
            recordedAt: new Date().toISOString(),
            isValid: true
          };
          setResponses((prev) => [...prev, record]);

          const nextQ = matchedOpt?.nextQuestionId || currentQuestion.defaultNextQuestionId || 'END';
          transitionToQuestion(nextQ);
        } else {
          handleInvalidInput(input);
        }
        break;
      }

      case 'numeric': {
        const finishKey = currentQuestion.finishOnKey || '#';
        if (input === finishKey) {
          const minRequired = currentQuestion.minDigits ?? 1;
          if (dialpadInput.length >= minRequired) {
            const enteredDigits = dialpadInput;
            const record: CallResponseRecord = {
              questionId: currentQuestion.id,
              questionName: currentQuestion.name,
              questionType: currentQuestion.type,
              promptText: currentQuestion.promptText,
              inputReceived: enteredDigits,
              inputMethod: 'dtmf',
              recordedAt: new Date().toISOString(),
              isValid: true
            };
            setResponses((prev) => [...prev, record]);
            setDialpadInput('');

            const nextQ = currentQuestion.defaultNextQuestionId || 'END';
            transitionToQuestion(nextQ);
          } else {
            handleInvalidInput(
              dialpadInput
                ? `"${dialpadInput}" (Minimum ${minRequired} digits required)`
                : 'No digits entered before pressing submit'
            );
          }
        } else {
          // Regular digit entered (0-9, *)
          const nextVal = dialpadInput + input;
          const maxAllowed = currentQuestion.maxDigits ?? 9;

          if (nextVal.length <= maxAllowed) {
            setDialpadInput(nextVal);

            // If max digits reached and no finish key configured, auto-submit immediately
            if (nextVal.length === maxAllowed && !currentQuestion.finishOnKey) {
              const record: CallResponseRecord = {
                questionId: currentQuestion.id,
                questionName: currentQuestion.name,
                questionType: currentQuestion.type,
                promptText: currentQuestion.promptText,
                inputReceived: nextVal,
                inputMethod: 'dtmf',
                recordedAt: new Date().toISOString(),
                isValid: true
              };
              setResponses((prev) => [...prev, record]);
              setDialpadInput('');

              const nextQ = currentQuestion.defaultNextQuestionId || 'END';
              transitionToQuestion(nextQ);
            }
          }
        }
        break;
      }

      default:
        transitionToQuestion(currentQuestion.defaultNextQuestionId || 'END');
        break;
    }
  };

  const handleInvalidInput = (raw: string) => {
    if (!currentQuestion) return;

    let msg = `Option "${raw}" is not recognized. Please select a valid key.`;
    if (
      currentQuestion.type === 'yes_no' ||
      currentQuestion.type === 'multiple_choice' ||
      currentQuestion.type === 'rating_1_5'
    ) {
      const validDigits = (currentQuestion.options || []).map((o) => o.dtmfDigit).filter(Boolean);
      if (validDigits.length > 0) {
        msg = `Option "${raw}" is not valid. Available options are: ${validDigits.join(', ')}. Please try again.`;
      }
    } else if (currentQuestion.type === 'numeric') {
      msg = `Invalid entry "${raw}". Please enter between ${currentQuestion.minDigits ?? 1} and ${
        currentQuestion.maxDigits ?? 9
      } digits, followed by ${currentQuestion.finishOnKey || '#'}.`;
    }

    setTranscript((prev) => [
      ...prev,
      { speaker: 'system', text: `[Invalid Input]: ${msg}`, timestamp: getNowTimeString() }
    ]);

    if (isAudioEnabled) {
      setIsTtsSpeaking(true);
      speechService.speak(msg, {
        voiceProfileId: selectedVoiceId,
        rate: 0.95,
        pitch: 1.01,
        onEnd: () => {
          setIsTtsSpeaking(false);
          startQuestionTimeoutTimer(currentQuestion);
        }
      });
    } else {
      startQuestionTimeoutTimer(currentQuestion);
    }
  };

  const endCall = (
    status: CallStatus,
    summary: string,
    hangupCause?: CallLog['hangupCause']
  ) => {
    if (questionTimeoutRef.current) clearTimeout(questionTimeoutRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    speechService.stop();
    phoneAudio.stopRingtone();
    phoneAudio.playDtmfTone('busy', 200);

    setCallState('ended');
    setIsTtsSpeaking(false);
    setStatusMessage(`Call ended: ${summary}`);

    const finalDuration = callDuration || 5;

    const callLog: CallLog = {
      id: `cl_${Date.now()}`,
      campaignId: selectedCampaignId || 'cmp_direct',
      campaignName: activeCampaign?.name || selectedQuestionnaire?.title || 'Interactive Session',
      contactId: selectedContact?.id || 'cnt_client',
      contactName: selectedContact?.name || 'Client',
      companyName: selectedContact?.companyName || 'Auckland Practice',
      phoneNumber: selectedContact?.phoneNumber || '+64 21 892 4101',
      startedAt: new Date(Date.now() - finalDuration * 1000).toISOString(),
      endedAt: new Date().toISOString(),
      durationSeconds: finalDuration,
      status,
      attemptNumber: 1,
      hangupCause: hangupCause || (status === 'transferred' ? 'transferred' : 'completed'),
      responses: [...responses],
      transcript: [...transcript]
    };

    if (onSaveCallLog) {
      onSaveCallLog(callLog);
    } else if (onCallCompleted) {
      onCallCompleted(callLog);
    }
  };

  const toggleMic = () => {
    if (isMicListening) {
      recognizerRef.current?.stop();
      setIsMicListening(false);
    } else {
      recognizerRef.current = createSpeechRecognizer(
        (recognized) => {
          setIsMicListening(false);
          processInput(recognized, 'voice');
        },
        () => {
          setIsMicListening(false);
        }
      );
      recognizerRef.current.start();
      setIsMicListening(true);
    }
  };

  const handleCloseModal = () => {
    speechService.stop();
    if (questionTimeoutRef.current) clearTimeout(questionTimeoutRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleCloseModal}
      size="full"
      title="Telephony Handset Trial Simulator"
      description="Interactive testing of voice prompts, DTMF digit navigation, speech recognition, and dynamic branching."
    >
      <div className="space-y-4">
        {/* Campaign & Contact Selector Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs">
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">Select Campaign / Flow</label>
            <select
              disabled={callState !== 'idle' && callState !== 'ended'}
              value={selectedCampaignId}
              onChange={(e) => handleCampaignChange(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-800 disabled:opacity-60"
            >
              {allCampaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              {allCampaigns.length === 0 && (
                <option value="">{selectedQuestionnaire?.title || 'Direct Flow'}</option>
              )}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">Select Practice Client</label>
            <select
              disabled={callState !== 'idle' && callState !== 'ended'}
              value={selectedContactId}
              onChange={(e) => setSelectedContactId(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-800 disabled:opacity-60"
            >
              {allContacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.companyName || c.phoneNumber})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Simulator Grid */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 min-h-[380px]">
          {/* Left: Handset / Controls (5 cols) */}
          <div className="md:col-span-5 bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between space-y-4">
            {/* Status Pill */}
            <div className="text-center">
              {callState === 'idle' && (
                <Badge variant="neutral" size="md">Ready to Dial</Badge>
              )}
              {callState === 'dialing' && (
                <Badge variant="info" size="md">Dialing Outbound...</Badge>
              )}
              {callState === 'ringing' && (
                <Badge variant="warning" size="md">Ringing Subscriber...</Badge>
              )}
              {callState === 'connected' && (
                <Badge variant="success" size="md" dot>
                  Connected · {formatTime(callDuration)}
                </Badge>
              )}
              {callState === 'ended' && (
                <Badge variant="neutral" size="md">Call Finished</Badge>
              )}
            </div>

            {/* Client info */}
            <div className="text-center space-y-0.5">
              <h4 className="text-base font-semibold text-slate-900">{selectedContact?.name || 'Client'}</h4>
              <p className="text-xs font-mono text-slate-600">{selectedContact?.phoneNumber || '+64 21 892 4101'}</p>
              <p className="text-[11px] text-slate-400">{selectedContact?.companyName || 'Auckland Client'}</p>
            </div>

            {/* Voice Engine selection */}
            <div className="p-2.5 bg-slate-50 border border-slate-200 rounded flex items-center justify-between gap-2 text-xs">
              <div className="min-w-0">
                <span className="text-[10px] text-slate-400 font-semibold block uppercase">Voice Engine</span>
                <select
                  disabled={callState === 'connected'}
                  value={selectedVoiceId}
                  onChange={(e) => setSelectedVoiceId(e.target.value)}
                  className="bg-transparent border-none p-0 text-xs font-semibold text-slate-800 focus:outline-none"
                >
                  {AVAILABLE_VOICE_PROFILES.map((vp) => (
                    <option key={vp.id} value={vp.id}>
                      {vp.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                variant="outline"
                size="xs"
                onClick={handlePlayVoiceSample}
                disabled={callState === 'connected'}
              >
                {isPlayingVoiceSample ? 'Stop' : 'Preview Voice'}
              </Button>
            </div>

            {/* Action buttons & DTMF keys */}
            <div className="space-y-3">
              {callState === 'idle' || callState === 'ended' ? (
                <Button
                  variant="primary"
                  size="md"
                  onClick={startCall}
                  className="w-full"
                  leftIcon={<Phone className="w-4 h-4" />}
                >
                  Place Test Voice Call
                </Button>
              ) : callState === 'dialing' || callState === 'ringing' ? (
                <div className="py-4 text-center text-xs text-slate-500 space-y-1">
                  <RotateCcw className="w-4 h-4 animate-spin mx-auto text-[#0f2e4a]" />
                  <p>{statusMessage}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Active Prompt display */}
                  {currentQuestion && (
                    <div className="p-3 bg-blue-50/50 border border-blue-200 rounded text-xs space-y-1">
                      <div className="text-[10px] font-semibold text-[#0f2e4a] uppercase">Current Prompt</div>
                      <p className="italic text-slate-800">"{substituteVariables(currentQuestion.promptText)}"</p>
                    </div>
                  )}

                  {/* Numeric Digit Entry Interface */}
                  {currentQuestion && currentQuestion.type === 'numeric' && (
                    <div className="space-y-2 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                      <div className="flex items-center justify-between text-[11px] font-semibold text-slate-700">
                        <span className="flex items-center gap-1">
                          <Hash className="w-3.5 h-3.5 text-[#0f2e4a]" />
                          <span>Numeric Input ({currentQuestion.minDigits ?? 1}–{currentQuestion.maxDigits ?? 9} digits):</span>
                        </span>
                        <span className="font-mono text-slate-500">
                          {dialpadInput.length} / {currentQuestion.maxDigits ?? 9}
                        </span>
                      </div>

                      {/* Live Digit Buffer Display */}
                      <div className="p-2.5 bg-white border border-slate-300 rounded font-mono font-bold text-center text-lg tracking-widest text-[#0f2e4a] min-h-[42px] flex items-center justify-center shadow-inner">
                        {dialpadInput ? (
                          <span>{dialpadInput}</span>
                        ) : (
                          <span className="text-xs font-normal text-slate-400">Click numbers or type on keyboard...</span>
                        )}
                      </div>

                      {/* 12-key Dialpad Grid */}
                      <div className="grid grid-cols-3 gap-1.5 pt-1">
                        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map((digit) => (
                          <button
                            key={digit}
                            type="button"
                            onClick={() => processInput(digit, 'dtmf')}
                            className={`h-9 bg-white border rounded font-mono font-bold text-sm flex items-center justify-center transition-colors cursor-pointer ${
                              digit === (currentQuestion.finishOnKey || '#')
                                ? 'bg-blue-50 border-[#0f2e4a] text-[#0f2e4a] hover:bg-blue-100'
                                : 'border-slate-200 hover:bg-slate-100 text-slate-800'
                            }`}
                          >
                            {digit}
                          </button>
                        ))}
                      </div>

                      {/* Controls: Backspace & Submit */}
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <Button
                          variant="outline"
                          size="xs"
                          disabled={!dialpadInput}
                          onClick={() => setDialpadInput((prev) => prev.slice(0, -1))}
                        >
                          ⌫ Backspace
                        </Button>
                        <Button
                          variant="primary"
                          size="xs"
                          disabled={dialpadInput.length < (currentQuestion.minDigits ?? 1)}
                          onClick={() => processInput(currentQuestion.finishOnKey || '#', 'dtmf')}
                        >
                          Submit ({currentQuestion.finishOnKey || '#'})
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* DTMF quick options (for discrete choice types) */}
                  {currentQuestion && currentQuestion.type !== 'numeric' && currentQuestion.options.length > 0 && (
                    <div className="space-y-1.5">
                      <span className="text-[11px] font-semibold text-slate-600 block">DTMF Digit Input:</span>
                      <div className="grid grid-cols-1 gap-1.5">
                        {currentQuestion.options.map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => processInput(opt.dtmfDigit, 'dtmf')}
                            className="w-full flex items-center justify-between px-3 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded text-xs font-medium text-slate-800 transition-colors cursor-pointer"
                          >
                            <span>{opt.label}</span>
                            <span className="w-5 h-5 rounded bg-slate-900 text-white font-mono text-[10px] flex items-center justify-center">
                              {opt.dtmfDigit}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Speech input & keypad toggle */}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                    {currentQuestion?.type !== 'numeric' ? (
                      <button
                        type="button"
                        onClick={() => setShowFullKeypad(!showFullKeypad)}
                        className="text-xs text-[#0f2e4a] hover:underline font-medium flex items-center gap-1"
                      >
                        <span>{showFullKeypad ? 'Hide Keypad' : 'Show Full Keypad'}</span>
                        <ChevronDown className={`w-3.5 h-3.5 transform transition-transform ${showFullKeypad ? 'rotate-180' : ''}`} />
                      </button>
                    ) : (
                      <span className="text-[11px] text-slate-500 font-medium">Keypad active</span>
                    )}

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={toggleMic}
                        className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                          isMicListening
                            ? 'bg-red-50 text-red-700 border-red-300 animate-pulse'
                            : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        {isMicListening ? <Mic className="w-3.5 h-3.5 inline mr-1 text-red-600" /> : <MicOff className="w-3.5 h-3.5 inline mr-1 text-slate-400" />}
                        <span>{isMicListening ? 'Listening...' : 'Voice Mic'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setIsAudioEnabled(!isAudioEnabled)}
                        className="p-1.5 rounded border border-slate-300 text-slate-600 hover:bg-slate-50"
                        title={isAudioEnabled ? 'Mute TTS Audio' : 'Enable TTS Audio'}
                      >
                        {isAudioEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5 text-slate-400" />}
                      </button>
                    </div>
                  </div>

                  {/* 12-key Dialpad Grid (for discrete choice types when expanded) */}
                  {showFullKeypad && currentQuestion?.type !== 'numeric' && (
                    <div className="grid grid-cols-3 gap-1.5 p-2 bg-slate-50 border border-slate-200 rounded">
                      {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map((digit) => (
                        <button
                          key={digit}
                          type="button"
                          onClick={() => processInput(digit, 'dtmf')}
                          className="h-8 bg-white border border-slate-200 hover:bg-slate-100 rounded font-mono font-bold text-xs text-slate-800 flex items-center justify-center transition-colors"
                        >
                          {digit}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Hang Up Button */}
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => endCall('completed', 'Subscriber hung up.', 'user_hangup')}
                    className="w-full"
                    leftIcon={<PhoneOff className="w-3.5 h-3.5" />}
                  >
                    Hang Up Call
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Right: Live Transcript & Captured Answers (7 cols) */}
          <div className="md:col-span-7 bg-slate-50 border border-slate-200 rounded-lg p-4 flex flex-col justify-between space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200 text-xs">
              <span className="font-semibold text-slate-800">Live Transcript Stream</span>
              {callState === 'connected' && (
                <span className="font-mono text-emerald-700 font-semibold flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" /> {formatTime(callDuration)}
                </span>
              )}
            </div>

            {/* Transcript Messages */}
            <div className="flex-1 overflow-y-auto space-y-3 min-h-[220px] max-h-[300px] pr-1">
              {transcript.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-400">
                  <p>Click "Place Test Voice Call" to run an interactive session.</p>
                </div>
              ) : (
                transcript.map((item, idx) => (
                  <div
                    key={idx}
                    className={`p-2.5 rounded-lg text-xs leading-relaxed ${
                      item.speaker === 'system'
                        ? 'bg-white border border-slate-200 text-slate-800'
                        : 'bg-blue-50/60 border border-blue-200 text-blue-900 ml-4'
                    }`}
                  >
                    <div className="text-[10px] text-slate-400 mb-0.5">
                      {item.speaker === 'system' ? 'Auckland Accounting IVR' : 'Client Subscriber'} · {item.timestamp}
                    </div>
                    <div>{item.text}</div>
                  </div>
                ))
              )}
            </div>

            {/* Captured responses summary */}
            {responses.length > 0 && (
              <div className="p-3 bg-white border border-slate-200 rounded-lg space-y-1.5 text-xs">
                <span className="font-semibold text-slate-800 block text-[11px] uppercase">
                  Captured Responses ({responses.length}):
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {responses.map((r, i) => (
                    <Badge key={i} variant="neutral" size="sm">
                      {r.questionName}: <strong>{r.inputReceived}</strong>
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
};
