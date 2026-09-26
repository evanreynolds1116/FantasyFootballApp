export type SocketData = {
  userId: string;
  draftId?: string;
  leagueId?: string;
  /**
   * Looked up when the socket joins (and on every resync) and reused for
   * each intent, saving a database round trip per bid. Safe to cache: team
   * claims lock once a draft exists and the commissioner never changes.
   * undefined = not looked up yet.
   */
  teamId?: string | null;
  isCommissioner?: boolean;
};
