import api from './api';

export interface FeedbackRow {
  id: string;
  customer_id: string;
  rating: number;
  message: string | null;
  created_at: string;
  firstname?: string;
  lastname?: string;
  email?: string;
}

export const feedbackService = {
  list: async (): Promise<FeedbackRow[]> => {
    const res = await api.get('/api/admin/feedback');
    return res.data.data || [];
  },
};