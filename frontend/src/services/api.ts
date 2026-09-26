// Acula API Client Abstraction
// Centralized communication layer with the Express REST API
import {
  Contact,
  ContactGroup,
  DncRecord,
  ConsentRecord,
  ConsentStatus,
  ParsedCsvRow,
  CsvPreviewResult,
  ImportSummaryResult,
  Campaign,
  Questionnaire,
  CampaignPreLaunchResult,
  FlowValidationResult,
  SummaryReportData,
  CampaignReportData,
  ReportDateFilter,
  FormattedPermission,
  RoleDefinition,
  GroupedPermissions
} from '../types';

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface SafeUser {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: string[];
  isActive: boolean;
  lastLoginAt?: string | null;
  createdAt: string;
}

export interface AuthResponseData {
  user: SafeUser;
  accessToken: string;
  refreshToken?: string;
}

export interface SystemHealthData {
  status: 'healthy' | 'degraded' | 'unhealthy';
  service: string;
  version: string;
  timestamp: string;
  uptimeSeconds: number;
  environment: string;
  database: {
    connected: boolean;
    status: string;
    latencyMs?: number;
    error?: string;
  };
  redis: {
    connected: boolean;
    status: string;
    latencyMs?: number;
    error?: string;
  };
}

class ApiClient {
  private baseUrl: string;
  private isRefreshing = false;
  private refreshSubscribers: Array<(token: string | null) => void> = [];

  constructor() {
    const customApi = import.meta.env.VITE_API_URL;
    if (customApi) {
      const trimmed = customApi.replace(/\/$/, '');
      this.baseUrl = trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
    } else {
      this.baseUrl = '/api';
    }
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  private accessToken: string | null = (() => {
    try {
      return localStorage.getItem('ak_access_token');
    } catch {
      return null;
    }
  })();

  public setAccessToken(token: string | null) {
    this.accessToken = token;
    try {
      if (token) {
        localStorage.setItem('ak_access_token', token);
      } else {
        localStorage.removeItem('ak_access_token');
      }
    } catch {
      // Storage unavailable in restricted sandboxes
    }
  }

  public getAccessToken(): string | null {
    if (!this.accessToken) {
      try {
        this.accessToken = localStorage.getItem('ak_access_token');
      } catch {
        return null;
      }
    }
    return this.accessToken;
  }

  public getRefreshToken(): string | null {
    try {
      return localStorage.getItem('ak_refresh_token');
    } catch {
      return null;
    }
  }

  public setRefreshToken(token: string | null) {
    try {
      if (token) {
        localStorage.setItem('ak_refresh_token', token);
      } else {
        localStorage.removeItem('ak_refresh_token');
      }
    } catch {
      // Storage unavailable in restricted sandboxes
    }
  }

  private onRefreshed(token: string | null) {
    this.refreshSubscribers.forEach((cb) => cb(token));
    this.refreshSubscribers = [];
  }

  private addRefreshSubscriber(cb: (token: string | null) => void) {
    this.refreshSubscribers.push(cb);
  }

  public async request<T>(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...((options.headers as Record<string, string>) || {})
    };

    const token = this.getAccessToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers,
        credentials: 'include' // Send HttpOnly refresh cookie
      });

      // Handle 401 on protected endpoints by attempting automatic silent refresh
      if (response.status === 401 && endpoint !== '/auth/login' && endpoint !== '/auth/refresh') {
        if (!this.isRefreshing) {
          this.isRefreshing = true;
          const refreshRes = await this.refresh();
          this.isRefreshing = false;

          if (refreshRes.success && refreshRes.data?.accessToken) {
            this.setAccessToken(refreshRes.data.accessToken);
            this.onRefreshed(refreshRes.data.accessToken);
            // Retry initial request with new token
            return this.request<T>(endpoint, options);
          } else {
            this.setAccessToken(null);
            this.onRefreshed(null);
          }
        } else {
          // Wait for ongoing refresh
          return new Promise((resolve) => {
            this.addRefreshSubscriber((newToken) => {
              if (newToken) {
                resolve(this.request<T>(endpoint, options));
              } else {
                resolve({
                  success: false,
                  error: {
                    code: 'UNAUTHORIZED',
                    message: 'Session expired. Please sign in again.'
                  }
                });
              }
            });
          });
        }
      }

      const data = await response.json();
      return data as ApiResponse<T>;
    } catch (error) {
      const err = error as Error;
      return {
        success: false,
        error: {
          code: 'NETWORK_ERROR',
          message: err.message || 'Failed to communicate with Acula API'
        }
      };
    }
  }

  // -----------------------------------------------------------
  // Telemetry & Health
  // -----------------------------------------------------------
  public async getHealth(): Promise<ApiResponse<SystemHealthData>> {
    return this.request<SystemHealthData>('/health');
  }

  // -----------------------------------------------------------
  // Authentication & Sessions
  // -----------------------------------------------------------
  public async login(email: string, password: string): Promise<ApiResponse<AuthResponseData>> {
    const res = await this.request<AuthResponseData>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });

    if (res.success && res.data) {
      if (res.data.accessToken) {
        this.setAccessToken(res.data.accessToken);
      }
      if (res.data.refreshToken) {
        this.setRefreshToken(res.data.refreshToken);
      }
    }
    return res;
  }

  public async refresh(explicitToken?: string): Promise<ApiResponse<AuthResponseData>> {
    const tokenToSend = explicitToken || this.getRefreshToken();
    const res = await this.request<AuthResponseData>('/auth/refresh', {
      method: 'POST',
      body: tokenToSend ? JSON.stringify({ refreshToken: tokenToSend }) : undefined
    });

    if (res.success && res.data) {
      if (res.data.accessToken) {
        this.setAccessToken(res.data.accessToken);
      }
      if (res.data.refreshToken) {
        this.setRefreshToken(res.data.refreshToken);
      }
    } else {
      // Clear token cache if refresh failed with unauthenticated state
      this.setAccessToken(null);
      this.setRefreshToken(null);
    }
    return res;
  }

  public async logout(): Promise<ApiResponse<{ message: string }>> {
    const tokenToSend = this.getRefreshToken();
    const res = await this.request<{ message: string }>('/auth/logout', {
      method: 'POST',
      body: tokenToSend ? JSON.stringify({ refreshToken: tokenToSend }) : undefined
    });
    this.setAccessToken(null);
    this.setRefreshToken(null);
    return res;
  }

  public async getCurrentUser(): Promise<ApiResponse<{ user: SafeUser }>> {
    return this.request<{ user: SafeUser }>('/auth/me');
  }

  public async forgotPassword(email: string): Promise<ApiResponse<{ message: string; developmentToken?: string }>> {
    return this.request('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email })
    });
  }

  public async resetPassword(token: string, password: string): Promise<ApiResponse<{ message: string }>> {
    return this.request('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password })
    });
  }

  // -----------------------------------------------------------
  // Contacts Domain
  // -----------------------------------------------------------
  public async getContacts(params: Record<string, any> = {}): Promise<ApiResponse<{ contacts: Contact[]; pagination: any }>> {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '' && v !== 'all') {
        query.append(k, String(v));
      }
    });
    const qs = query.toString();
    return this.request(`/contacts${qs ? `?${qs}` : ''}`);
  }

  public async getContactById(id: string): Promise<ApiResponse<Contact>> {
    return this.request(`/contacts/${id}`);
  }

  public async createContact(payload: Partial<Contact> & { groupIds?: string[] }): Promise<ApiResponse<Contact>> {
    return this.request('/contacts', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  public async updateContact(id: string, payload: Partial<Contact> & { groupIds?: string[] }): Promise<ApiResponse<Contact>> {
    return this.request(`/contacts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  }

  public async deleteContact(id: string): Promise<ApiResponse<{ success: boolean; deletedId: string }>> {
    return this.request(`/contacts/${id}`, {
      method: 'DELETE'
    });
  }

  public async getContactConsent(id: string): Promise<ApiResponse<{ contact: any; history: ConsentRecord[] }>> {
    return this.request(`/contacts/${id}/consent`);
  }

  public async recordContactConsent(id: string, payload: { status: ConsentStatus; source?: string; notes?: string }): Promise<ApiResponse<any>> {
    return this.request(`/contacts/${id}/consent`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  public async previewCsvImport(csvContent: string): Promise<ApiResponse<CsvPreviewResult>> {
    return this.request('/contacts/import/preview', {
      method: 'POST',
      body: JSON.stringify({ csvContent })
    });
  }

  public async confirmCsvImport(payload: { rows: ParsedCsvRow[]; targetGroupId?: string; duplicateStrategy?: 'SKIP' | 'UPDATE' }): Promise<ApiResponse<ImportSummaryResult>> {
    return this.request('/contacts/import/confirm', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  // -----------------------------------------------------------
  // Contact Groups Domain
  // -----------------------------------------------------------
  public async getContactGroups(): Promise<ApiResponse<ContactGroup[]>> {
    return this.request('/contacts/groups');
  }

  public async getContactGroupById(id: string, params: Record<string, any> = {}): Promise<ApiResponse<{ group: ContactGroup; members: Contact[]; pagination: any }>> {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') {
        query.append(k, String(v));
      }
    });
    const qs = query.toString();
    return this.request(`/contacts/groups/${id}${qs ? `?${qs}` : ''}`);
  }

  public async createContactGroup(payload: { name: string; description?: string }): Promise<ApiResponse<ContactGroup>> {
    return this.request('/contacts/groups', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  public async updateContactGroup(id: string, payload: { name?: string; description?: string }): Promise<ApiResponse<ContactGroup>> {
    return this.request(`/contacts/groups/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  }

  public async deleteContactGroup(id: string): Promise<ApiResponse<{ success: boolean; deletedId: string }>> {
    return this.request(`/contacts/groups/${id}`, {
      method: 'DELETE'
    });
  }

  public async addGroupMembers(groupId: string, contactIds: string[]): Promise<ApiResponse<{ success: boolean; addedCount: number }>> {
    return this.request(`/contacts/groups/${groupId}/members`, {
      method: 'POST',
      body: JSON.stringify({ contactIds })
    });
  }

  public async removeGroupMember(groupId: string, contactId: string): Promise<ApiResponse<{ success: boolean }>> {
    return this.request(`/contacts/groups/${groupId}/members/${contactId}`, {
      method: 'DELETE'
    });
  }

  // -----------------------------------------------------------
  // Do-Not-Call (DNC) Registry Domain
  // -----------------------------------------------------------
  public async getDncRecords(params: Record<string, any> = {}): Promise<ApiResponse<{ records: DncRecord[]; pagination: any }>> {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') {
        query.append(k, String(v));
      }
    });
    const qs = query.toString();
    return this.request(`/dnc${qs ? `?${qs}` : ''}`);
  }

  public async checkDncSuppression(phoneNumber: string): Promise<ApiResponse<{ isSuppressed: boolean; normalizedPhone: string }>> {
    return this.request(`/dnc/check/${encodeURIComponent(phoneNumber)}`);
  }

  public async addToDnc(payload: { phoneNumber: string; reason?: string; source?: string }): Promise<ApiResponse<DncRecord>> {
    return this.request('/dnc', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  public async removeFromDnc(id: string): Promise<ApiResponse<{ success: boolean; removedPhone: string }>> {
    return this.request(`/dnc/${id}`, {
      method: 'DELETE'
    });
  }

  // -----------------------------------------------------------
  // Campaigns Domain
  // -----------------------------------------------------------
  public async getCampaigns(params: Record<string, any> = {}): Promise<ApiResponse<{ campaigns: Campaign[]; pagination: any }>> {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') {
        query.append(k, String(v));
      }
    });
    const qs = query.toString();
    return this.request(`/campaigns${qs ? `?${qs}` : ''}`);
  }

  public async getCampaignById(id: string): Promise<ApiResponse<Campaign>> {
    return this.request(`/campaigns/${id}`);
  }

  public async createCampaign(payload: Partial<Campaign> & { targetGroupIds?: string[] }): Promise<ApiResponse<Campaign>> {
    return this.request('/campaigns', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  public async updateCampaign(id: string, payload: Partial<Campaign>): Promise<ApiResponse<Campaign>> {
    return this.request(`/campaigns/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  }

  public async attachContactsToCampaign(id: string, payload: { contactIds?: string[]; groupIds?: string[] }): Promise<ApiResponse<any>> {
    return this.request(`/campaigns/${id}/contacts`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  public async deleteCampaign(id: string): Promise<ApiResponse<{ success: boolean; deletedId: string }>> {
    return this.request(`/campaigns/${id}`, {
      method: 'DELETE'
    });
  }

  public async validateCampaign(id: string): Promise<ApiResponse<CampaignPreLaunchResult>> {
    return this.request(`/campaigns/${id}/validate`, {
      method: 'POST'
    });
  }

  public async startCampaign(id: string): Promise<ApiResponse<Campaign>> {
    return this.request(`/campaigns/${id}/start`, {
      method: 'POST'
    });
  }

  public async pauseCampaign(id: string): Promise<ApiResponse<Campaign>> {
    return this.request(`/campaigns/${id}/pause`, {
      method: 'POST'
    });
  }

  public async resumeCampaign(id: string): Promise<ApiResponse<Campaign>> {
    return this.request(`/campaigns/${id}/resume`, {
      method: 'POST'
    });
  }

  public async cancelCampaign(id: string): Promise<ApiResponse<Campaign>> {
    return this.request(`/campaigns/${id}/cancel`, {
      method: 'POST'
    });
  }

  public async emergencyStopAllCampaigns(): Promise<ApiResponse<{ stoppedCount: number; message: string }>> {
    return this.request('/campaigns/emergency-stop', {
      method: 'POST'
    });
  }

  public async attachCampaignContacts(
    id: string,
    payload: { contactIds?: string[]; groupIds?: string[] }
  ): Promise<ApiResponse<{ success: boolean; addedCount: number }>> {
    return this.request(`/campaigns/${id}/contacts`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  public async removeCampaignContact(id: string, contactId: string): Promise<ApiResponse<{ success: boolean }>> {
    return this.request(`/campaigns/${id}/contacts/${contactId}`, {
      method: 'DELETE'
    });
  }

  // -----------------------------------------------------------
  // Calls Domain
  // -----------------------------------------------------------
  public async getCalls(params: Record<string, any> = {}): Promise<
    ApiResponse<{
      calls: any[];
      pagination: { page: number; limit: number; total: number; totalPages: number };
    }>
  > {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') {
        query.append(k, String(v));
      }
    });
    const qs = query.toString();
    return this.request(`/calls${qs ? `?${qs}` : ''}`);
  }

  public async getCallById(id: string): Promise<ApiResponse<{ call: any }>> {
    return this.request(`/calls/${id}`);
  }

  public async testLiveCall(payload: {
    phoneNumber?: string;
    callerId?: string;
    campaignId?: string;
  }): Promise<
    ApiResponse<{
      callSid: string;
      status: string;
      to: string;
      from: string;
      direction: string;
      dateCreated?: string;
    }>
  > {
    return this.request('/calls/test-live', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  public async getLiveCallStatus(callSid: string): Promise<
    ApiResponse<{
      callSid: string;
      status: string;
      duration: number;
      startTime?: string;
      endTime?: string;
      to: string;
      from: string;
    }>
  > {
    return this.request(`/calls/live-status/${callSid}`);
  }

  public async hangupLiveCall(callSid: string): Promise<
    ApiResponse<{
      callSid: string;
      status: string;
    }>
  > {
    return this.request(`/calls/live-hangup/${callSid}`, {
      method: 'POST'
    });
  }

  // -----------------------------------------------------------
  // Questionnaire / IVR Flow Domain
  // -----------------------------------------------------------
  public async getQuestionnaires(): Promise<ApiResponse<Questionnaire[]>> {
    return this.request('/questionnaires');
  }

  public async getQuestionnaireById(id: string): Promise<ApiResponse<Questionnaire & { validation?: FlowValidationResult }>> {
    return this.request(`/questionnaires/${id}`);
  }

  public async createQuestionnaire(payload: { title: string; description?: string; category?: string }): Promise<ApiResponse<Questionnaire>> {
    return this.request('/questionnaires', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  public async updateQuestionnaire(id: string, payload: Partial<Questionnaire>): Promise<ApiResponse<Questionnaire>> {
    return this.request(`/questionnaires/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  }

  public async deleteQuestionnaire(id: string): Promise<ApiResponse<{ success: boolean; deletedId: string }>> {
    return this.request(`/questionnaires/${id}`, {
      method: 'DELETE'
    });
  }

  public async validateQuestionnaire(id: string): Promise<ApiResponse<FlowValidationResult>> {
    return this.request(`/questionnaires/${id}/validate`, {
      method: 'POST'
    });
  }

  public async addQuestionnaireQuestion(questionnaireId: string, payload: any): Promise<ApiResponse<any>> {
    return this.request(`/questionnaires/${questionnaireId}/questions`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  public async updateQuestionnaireQuestion(questionId: string, payload: any): Promise<ApiResponse<any>> {
    return this.request(`/questionnaires/questions/${questionId}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  }

  public async deleteQuestionnaireQuestion(questionId: string): Promise<ApiResponse<{ success: boolean; deletedId: string }>> {
    return this.request(`/questionnaires/questions/${questionId}`, {
      method: 'DELETE'
    });
  }

  // -----------------------------------------------------------
  // Reporting & Analytics Domain
  // -----------------------------------------------------------
  public async getSummaryReport(params: ReportDateFilter = {}): Promise<ApiResponse<SummaryReportData>> {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '' && v !== 'all') {
        query.append(k, String(v));
      }
    });
    const qs = query.toString();
    return this.request(`/reports/summary${qs ? `?${qs}` : ''}`);
  }

  public async getCampaignReport(id: string, params: ReportDateFilter = {}): Promise<ApiResponse<CampaignReportData>> {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '' && v !== 'all') {
        query.append(k, String(v));
      }
    });
    const qs = query.toString();
    return this.request(`/reports/campaigns/${id}${qs ? `?${qs}` : ''}`);
  }

  // -----------------------------------------------------------
  // Roles & Permissions Domain (SUPER_ADMIN Dynamic RBAC)
  // -----------------------------------------------------------
  public async getPermissions(): Promise<ApiResponse<{ permissions: FormattedPermission[]; grouped: GroupedPermissions }>> {
    return this.request('/roles/permissions');
  }

  public async getRoles(): Promise<ApiResponse<{ roles: RoleDefinition[] }>> {
    return this.request('/roles');
  }

  public async getRole(roleId: string): Promise<ApiResponse<{ role: RoleDefinition }>> {
    return this.request(`/roles/${roleId}`);
  }

  public async updateRolePermissions(
    roleId: string,
    permissions: string[]
  ): Promise<ApiResponse<{ role: RoleDefinition; message: string }>> {
    return this.request(`/roles/${roleId}/permissions`, {
      method: 'PUT',
      body: JSON.stringify({ permissions })
    });
  }
}

export const api = new ApiClient();
