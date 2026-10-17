import { useEffect, useState } from 'react';
import { errorMessage, reportError } from '../../../core/errors';
import { fb } from '../../../core/firebase';
import { getLink } from '../../signing/data/signLinksRepo';
import { getTemplates } from '../data/templatesRepo';
import type { DocKind, DocTemplate } from '../domain/template';

/**
 * The template a document prints with. A signed voucher/confirmation prints
 * exactly as it was signed (owner decision 2026-10-17): the template copied
 * into its signing link, or the current document if it had none. Otherwise
 * the account's current template. null = the current (default) document.
 */
export function useDocTemplate(
  accountId: string,
  kind: DocKind,
  signLinkId: string | null,
  ready: boolean,
): { template: DocTemplate | null | undefined; error: string } {
  const [state, setState] = useState<{
    key: string;
    template: DocTemplate | null;
    error: string;
  } | null>(null);
  const key = `${accountId}/${kind}/${signLinkId ?? ''}`;
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const { db } = fb();
    const load = signLinkId
      ? getLink(db, signLinkId).then((l) => l?.template ?? null)
      : getTemplates(db, accountId).then((t) => t[kind] ?? null);
    load
      .then((template) => alive && setState({ key, template, error: '' }))
      .catch((e) => {
        reportError('doc-template', e);
        if (alive) setState({ key, template: null, error: errorMessage(e) });
      });
    return () => {
      alive = false;
    };
  }, [accountId, kind, signLinkId, ready, key]);
  if (!state || state.key !== key) return { template: undefined, error: '' };
  return { template: state.template, error: state.error };
}
