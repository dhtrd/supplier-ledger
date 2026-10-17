import { useEffect, useState } from 'react';
import { errorMessage, reportError } from '../../../core/errors';
import { fb } from '../../../core/firebase';
import { getTemplates } from '../data/templatesRepo';
import type { DocKind, DocTemplate } from '../domain/template';

/**
 * The template a document prints with: always the account's current one,
 * signed documents included (owner decision 2026-10-17, replacing «a signed
 * document prints as it was signed»). The signature, amount, balance, number
 * and date still come from the signed entry. null = the default document.
 */
export function useDocTemplate(
  accountId: string,
  kind: DocKind,
  ready: boolean,
): { template: DocTemplate | null | undefined; error: string } {
  const [state, setState] = useState<{
    key: string;
    template: DocTemplate | null;
    error: string;
  } | null>(null);
  const key = `${accountId}/${kind}`;
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    getTemplates(fb().db, accountId)
      .then((t) => alive && setState({ key, template: t[kind] ?? null, error: '' }))
      .catch((e) => {
        reportError('doc-template', e);
        if (alive) setState({ key, template: null, error: errorMessage(e) });
      });
    return () => {
      alive = false;
    };
  }, [accountId, kind, ready, key]);
  if (!state || state.key !== key) return { template: undefined, error: '' };
  return { template: state.template, error: state.error };
}
