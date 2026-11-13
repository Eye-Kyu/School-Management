// @vitest-environment jsdom
// SA-02 / submissions-file-urls lead: only assignments-bucket paths become
// clickable, and they open through a signed URL rather than an href.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const createSignedUrl = vi.fn(async () => ({ data: { signedUrl: 'https://signed.example/x' }, error: null }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ storage: { from: () => ({ createSignedUrl }) } }),
}));

import SubmissionFileLink from './SubmissionFileLink';

describe('SubmissionFileLink', () => {
  it('renders an arbitrary URL as plain text, never as a link', () => {
    const { container } = render(<SubmissionFileLink value="javascript:alert(document.cookie)" />);
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
    expect(screen.getByText('Unsupported file reference')).toBeTruthy();
  });

  it('opens a storage path via a short-lived signed URL', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<SubmissionFileLink value="submissions/a1/u1/1700000000000_essay.pdf" />);
    fireEvent.click(screen.getByRole('button', { name: 'essay.pdf' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://signed.example/x', '_blank', 'noopener,noreferrer'));
    expect(createSignedUrl).toHaveBeenCalledWith('submissions/a1/u1/1700000000000_essay.pdf', 60);
    open.mockRestore();
  });
});
