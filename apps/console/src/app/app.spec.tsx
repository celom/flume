import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import App from './app';

describe('App', () => {
  it('renders the navigation header', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );
    expect(screen.getByRole('link', { name: 'Prose Console' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'catalog' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'live' })).toBeTruthy();
  });

  it('prompts for ?correlationId on the trace route when none is set', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );
    expect(screen.getByText(/correlationId/i)).toBeTruthy();
  });
});
