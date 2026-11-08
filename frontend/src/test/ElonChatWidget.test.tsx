import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import ElonChatWidget from '../components/elon/ElonChatWidget';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: {
    chatWithElon: vi.fn(),
  },
}));

describe('ElonChatWidget Component (TDD Suite)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock scrollIntoView
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('renders the circular floating launcher button at bottom-right initially', () => {
    render(<ElonChatWidget />);
    const fab = screen.getByTestId('elon-fab-button');
    expect(fab).toBeInTheDocument();
    expect(fab).toHaveAttribute('title', 'Chat with ELON');
    expect(screen.queryByTestId('elon-chat-dialog')).not.toBeInTheDocument();
  });

  it('toggles open the Chat with ELON dialog when floating launcher is clicked', () => {
    render(<ElonChatWidget />);
    const fab = screen.getByTestId('elon-fab-button');

    // Open chat
    fireEvent.click(fab);
    expect(screen.getByTestId('elon-chat-dialog')).toBeInTheDocument();
    expect(screen.getByText('Chat with')).toBeInTheDocument();
    expect(screen.getByText('ELON')).toBeInTheDocument();
    expect(screen.getByText(/I am ELON, your hospital operations coordinator/i)).toBeInTheDocument();

    // Close chat via FAB
    fireEvent.click(fab);
    expect(screen.queryByTestId('elon-chat-dialog')).not.toBeInTheDocument();
  });

  it('closes dialog when the minimize / close button is clicked in the header', () => {
    render(<ElonChatWidget />);
    const fab = screen.getByTestId('elon-fab-button');
    fireEvent.click(fab);

    const closeBtn = screen.getByRole('button', { name: /close/i });
    fireEvent.click(closeBtn);
    expect(screen.queryByTestId('elon-chat-dialog')).not.toBeInTheDocument();
  });

  it('sends user message and displays ELON conversational response bubble', async () => {
    vi.mocked(api.chatWithElon).mockResolvedValueOnce({
      response: 'ICU currently has 3 beds available with full ventilator support.',
      session_id: 'session-123',
      timestamp: '2026-11-08T12:00:00Z',
    });

    render(<ElonChatWidget />);
    const fab = screen.getByTestId('elon-fab-button');
    fireEvent.click(fab);

    const input = screen.getByPlaceholderText('Ask ELON a question...');
    fireEvent.change(input, { target: { value: 'What is ICU availability?' } });

    const sendBtn = screen.getByRole('button', { name: /send message/i });
    fireEvent.click(sendBtn);

    // Verify user message appears in thread
    expect(screen.getByText('What is ICU availability?')).toBeInTheDocument();

    // Verify ELON reply appears
    await waitFor(() => {
      expect(screen.getByText('ICU currently has 3 beds available with full ventilator support.')).toBeInTheDocument();
    });

    expect(api.chatWithElon).toHaveBeenCalledWith({ message: 'What is ICU availability?' });
  });

  it('sends message when clicking a quick suggestion chip', async () => {
    vi.mocked(api.chatWithElon).mockResolvedValueOnce({
      response: 'There is currently 1 bed flagged as DIRTY: ER-103 in Trauma Bay C.',
      session_id: 'session-123',
      timestamp: '2026-11-08T12:00:00Z',
    });

    render(<ElonChatWidget />);
    const fab = screen.getByTestId('elon-fab-button');
    fireEvent.click(fab);

    const dirtyChip = screen.getByRole('button', { name: 'Dirty beds queue' });
    fireEvent.click(dirtyChip);

    await waitFor(() => {
      expect(screen.getByText('There is currently 1 bed flagged as DIRTY: ER-103 in Trauma Bay C.')).toBeInTheDocument();
    });

    expect(api.chatWithElon).toHaveBeenCalledWith({ message: 'Dirty beds queue' });
  });

  it('handles API error gracefully without crashing', async () => {
    vi.mocked(api.chatWithElon).mockRejectedValueOnce(new Error('Network error'));

    render(<ElonChatWidget />);
    const fab = screen.getByTestId('elon-fab-button');
    fireEvent.click(fab);

    const input = screen.getByPlaceholderText('Ask ELON a question...');
    fireEvent.change(input, { target: { value: 'Test query' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(screen.getByText(/Unable to reach ELON operations service right now/i)).toBeInTheDocument();
    });
  });
});

