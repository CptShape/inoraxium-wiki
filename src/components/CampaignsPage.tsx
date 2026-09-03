import React, { useEffect, useMemo, useState } from 'react';
import { Backpack, Copy, Crown, Eye, Plus, RefreshCw, Shield, Sparkles, Trash2, Users } from 'lucide-react';
import { AuthState, authProvider } from '../lib/auth';
import {
  addCharacterToParty,
  createCampaign,
  createParty,
  ensureCampaignInvite,
  joinCampaignByInvite,
  loadAdminAccess,
  loadCampaignsForUser,
  loadCharacters,
  loadPartiesForCampaign,
  saveCharacter,
  saveParty,
} from '../lib/firestore';
import {
  CampaignData,
  CharacterData,
  CharacterGeneralItem,
  CharacterInventoryItem,
  CharacterSpell,
  CharacterStatus,
  PartyData,
} from '../types/character';

type PartyTab = 'characters' | 'inventory' | 'spells' | 'statuses';
type PartyEntrySource = 'general-item' | 'inventory-item' | 'spell' | 'status';

const uid = (prefix = '') => `${prefix}${Math.random().toString(36).slice(2, 10)}`;

const cloneWithId = <T extends { id: string }>(entry: T, prefix: string): T => ({
  ...(JSON.parse(JSON.stringify(entry)) as T),
  id: uid(prefix),
});

const getInviteParams = () => {
  const params = new URLSearchParams(window.location.search);
  const value = params.get('campaignInvite') || '';
  const [campaignId, inviteCode] = value.split('.');
  return campaignId && inviteCode ? { campaignId, inviteCode } : null;
};

const buildInviteUrl = (campaign: CampaignData) => {
  const url = new URL(window.location.href);
  url.searchParams.set('campaignInvite', `${campaign.id}.${campaign.inviteCode}`);
  url.hash = '#tools/campaigns';
  return url.toString();
};

const openHomebrewCharacterSheet = (characterId: string) => {
  const targetUrl = `${window.location.origin}${window.location.pathname}#homebrew-character-sheet/${encodeURIComponent(characterId)}`;
  window.open(targetUrl, '_blank', 'noopener,noreferrer');
};

const CampaignsPage: React.FC = () => {
  const [authState, setAuthState] = useState<AuthState>({ uid: null, displayName: null, email: null });
  const [isAdmin, setIsAdmin] = useState(false);
  const [campaigns, setCampaigns] = useState<CampaignData[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [parties, setParties] = useState<PartyData[]>([]);
  const [selectedPartyId, setSelectedPartyId] = useState<string | null>(null);
  const [characters, setCharacters] = useState<CharacterData[]>([]);
  const [newCampaignName, setNewCampaignName] = useState('');
  const [newPartyName, setNewPartyName] = useState('');
  const [partyTab, setPartyTab] = useState<PartyTab>('characters');
  const [statusMessage, setStatusMessage] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => authProvider.onAuthChange(setAuthState), []);

  useEffect(() => {
    let cancelled = false;
    loadAdminAccess(authState.uid, authState.email).then((access) => {
      if (!cancelled) setIsAdmin(access.isAdmin);
    });
    return () => {
      cancelled = true;
    };
  }, [authState.uid, authState.email]);

  const selectedCampaign = campaigns.find((campaign) => campaign.id === selectedCampaignId) || null;
  const isSelectedCampaignDm = !!authState.uid && !!selectedCampaign && (isAdmin || selectedCampaign.dmUserIds.includes(authState.uid));
  const selectedParty = parties.find((party) => party.id === selectedPartyId) || null;

  const refreshCampaigns = async () => {
    if (!authState.uid) {
      setCampaigns([]);
      return;
    }
    const next = await loadCampaignsForUser(authState.uid, isAdmin);
    setCampaigns(next);
    if (selectedCampaignId && !next.some((campaign) => campaign.id === selectedCampaignId)) {
      setSelectedCampaignId(null);
      setSelectedPartyId(null);
    }
  };

  useEffect(() => {
    refreshCampaigns().catch((error) => {
      console.error(error);
      setStatusMessage('Campaigns could not be loaded.');
    });
  }, [authState.uid, isAdmin]);

  useEffect(() => {
    const invite = getInviteParams();
    if (!invite || !authState.uid) return;

    joinCampaignByInvite(invite.campaignId, invite.inviteCode, authState.uid, authState)
      .then((campaign) => {
        setStatusMessage(`Joined "${campaign.name}" as player.`);
        setSelectedCampaignId(campaign.id);
        const url = new URL(window.location.href);
        url.searchParams.delete('campaignInvite');
        window.history.replaceState(null, '', `${url.pathname}${url.search}#tools/campaigns`);
        return refreshCampaigns();
      })
      .catch((error) => {
        console.error(error);
        setStatusMessage(error instanceof Error ? error.message : 'Invite could not be accepted.');
      });
  }, [authState.uid]);

  useEffect(() => {
    if (!selectedCampaign || !authState.uid) {
      setParties([]);
      return;
    }
    loadPartiesForCampaign(selectedCampaign.id, authState.uid, isSelectedCampaignDm)
      .then((loadedParties) => {
        setParties(loadedParties);
        if (selectedPartyId && !loadedParties.some((party) => party.id === selectedPartyId)) {
          setSelectedPartyId(null);
        }
      })
      .catch((error) => {
        console.error(error);
        setStatusMessage('Parties could not be loaded.');
      });
  }, [authState.uid, isSelectedCampaignDm, selectedCampaign?.id]);

  useEffect(() => {
    if (!authState.uid) {
      setCharacters([]);
      return;
    }
    loadCharacters(authState.uid, isAdmin).then(setCharacters).catch((error) => {
      console.error(error);
      setStatusMessage('Characters could not be loaded.');
    });
  }, [authState.uid, isAdmin]);

  const addableCharacters = characters.filter((character) => (
    selectedParty
    && !selectedParty.characterIds.includes(character.id)
    && (
      isAdmin
      || character.userId === authState.uid
      || (!!authState.uid && (character.controlUserIds || []).includes(authState.uid))
    )
  ));

  const partyCharacters = useMemo(
    () => selectedParty
      ? selectedParty.characterIds.map((id) => characters.find((character) => character.id === id)).filter((character): character is CharacterData => !!character)
      : [],
    [characters, selectedParty],
  );

  const controlledCharacters = characters.filter((character) => (
    isAdmin
    || character.userId === authState.uid
    || (!!authState.uid && (character.controlUserIds || []).includes(authState.uid))
  ));

  const handleCreateCampaign = async () => {
    if (!authState.uid) return;
    setIsBusy(true);
    try {
      const campaign = await createCampaign(authState.uid, authState, newCampaignName);
      setCampaigns((current) => [campaign, ...current]);
      setSelectedCampaignId(campaign.id);
      setNewCampaignName('');
      setStatusMessage(`Campaign "${campaign.name}" created.`);
    } catch (error) {
      console.error(error);
      setStatusMessage(error instanceof Error ? error.message : 'Campaign could not be created.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleCreateParty = async () => {
    if (!authState.uid || !selectedCampaign) return;
    setIsBusy(true);
    try {
      const party = await createParty(selectedCampaign.id, authState.uid, newPartyName);
      setParties((current) => [party, ...current]);
      setSelectedPartyId(party.id);
      setNewPartyName('');
      setStatusMessage(`Party "${party.name}" created.`);
    } catch (error) {
      console.error(error);
      setStatusMessage(error instanceof Error ? error.message : 'Party could not be created.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleCopyInvite = async () => {
    if (!selectedCampaign) return;
    await ensureCampaignInvite(selectedCampaign);
    const url = buildInviteUrl(selectedCampaign);
    await navigator.clipboard.writeText(url);
    setStatusMessage('Invite link copied.');
  };

  const handleAddCharacter = async (characterId: string) => {
    if (!selectedParty) return;
    setIsBusy(true);
    try {
      const nextParty = await addCharacterToParty(selectedParty, characterId);
      setParties((current) => current.map((party) => party.id === nextParty.id ? nextParty : party));
      setStatusMessage('Character added to party. Campaign DMs were added to its view access.');
    } catch (error) {
      console.error(error);
      setStatusMessage(error instanceof Error ? error.message : 'Character could not be added.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleTogglePartyVisibility = async () => {
    if (!selectedParty || !authState.uid) return;
    const canChange = isSelectedCampaignDm || selectedParty.createdBy === authState.uid;
    if (!canChange) return;
    const nextParty: PartyData = {
      ...selectedParty,
      visibility: selectedParty.visibility === 'public' ? 'private' : 'public',
    };
    await saveParty(nextParty);
    setParties((current) => current.map((party) => party.id === nextParty.id ? nextParty : party));
  };

  const takeFromParty = async (
    targetCharacterId: string,
    kind: 'item' | 'spell' | 'status',
    entry: CharacterGeneralItem | CharacterInventoryItem | CharacterSpell | CharacterStatus,
  ) => {
    const character = characters.find((item) => item.id === targetCharacterId);
    if (!character) return;

    const nextCharacter: CharacterData = { ...character };
    if (kind === 'item') {
      nextCharacter.generalItems = [...(character.generalItems || []), cloneWithId(entry as CharacterGeneralItem | CharacterInventoryItem, 'gen_') as CharacterGeneralItem];
    } else if (kind === 'spell') {
      nextCharacter.spells = [...(character.spells || []), cloneWithId(entry as CharacterSpell, 'sp_')];
    } else {
      nextCharacter.statuses = [...(character.statuses || []), cloneWithId(entry as CharacterStatus, 'st_')];
    }

    await saveCharacter(nextCharacter);
    setCharacters((current) => current.map((item) => item.id === nextCharacter.id ? nextCharacter : item));
    setStatusMessage(`${entry.name || 'Entry'} copied to ${nextCharacter.name}.`);
  };

  const persistSelectedParty = async (nextParty: PartyData, message: string) => {
    await saveParty(nextParty);
    setParties((current) => current.map((party) => party.id === nextParty.id ? nextParty : party));
    setStatusMessage(message);
  };

  const updatePartyItemQuantity = async (
    source: PartyEntrySource,
    entryId: string,
    rawValue: string,
  ) => {
    if (!selectedParty || (source !== 'general-item' && source !== 'inventory-item')) return;
    const quantity = Math.max(0, parseInt(rawValue.replace(/\D/g, ''), 10) || 0);
    const nextParty: PartyData = {
      ...selectedParty,
      generalItems: source === 'general-item'
        ? (selectedParty.generalItems || []).map((item) => item.id === entryId ? { ...item, quantity } : item)
        : selectedParty.generalItems,
      inventory: source === 'inventory-item'
        ? (selectedParty.inventory || []).map((item) => item.id === entryId ? { ...item, quantity } : item)
        : selectedParty.inventory,
    };
    await persistSelectedParty(nextParty, 'Party item quantity updated.');
  };

  const removePartyEntry = async (source: PartyEntrySource, entryId: string) => {
    if (!selectedParty) return;
    const nextParty: PartyData = {
      ...selectedParty,
      generalItems: source === 'general-item'
        ? (selectedParty.generalItems || []).filter((entry) => entry.id !== entryId)
        : selectedParty.generalItems,
      inventory: source === 'inventory-item'
        ? (selectedParty.inventory || []).filter((entry) => entry.id !== entryId)
        : selectedParty.inventory,
      spells: source === 'spell'
        ? (selectedParty.spells || []).filter((entry) => entry.id !== entryId)
        : selectedParty.spells,
      statuses: source === 'status'
        ? (selectedParty.statuses || []).filter((entry) => entry.id !== entryId)
        : selectedParty.statuses,
    };
    await persistSelectedParty(nextParty, 'Entry removed from party inventory.');
  };

  const renderEntryCard = (
    kind: 'item' | 'spell' | 'status',
    entry: CharacterGeneralItem | CharacterInventoryItem | CharacterSpell | CharacterStatus,
    source: PartyEntrySource,
  ) => (
    <div key={`${kind}-${entry.id}`} className="rounded-xl border border-sky-800/35 bg-black/30 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-lg font-bold text-sky-100" style={{ fontFamily: "'Cinzel', serif" }}>{entry.name || 'Unnamed Entry'}</h4>
          {'description' in entry && entry.description && <p className="mt-2 max-w-2xl whitespace-pre-wrap text-sm text-sky-100/65">{entry.description}</p>}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {'quantity' in entry && (
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={entry.quantity}
              onChange={(event) => updatePartyItemQuantity(source, entry.id, event.target.value)}
              className="w-[11ch] rounded-lg border border-sky-800/45 bg-stone-950/70 px-3 py-2 text-sm text-sky-100 outline-none focus:border-cyan-400"
              aria-label="Quantity"
            />
          )}
          {controlledCharacters.length > 0 && (
            <select
              defaultValue=""
              onChange={(event) => {
                if (!event.target.value) return;
                takeFromParty(event.target.value, kind, entry);
                event.target.value = '';
              }}
              className="rounded-lg border border-emerald-700/45 bg-emerald-950/35 px-3 py-2 text-sm text-emerald-100"
            >
              <option value="">Take...</option>
              {controlledCharacters.map((character) => (
                <option key={character.id} value={character.id}>{character.name}</option>
              ))}
            </select>
          )}
          <button
            onClick={() => removePartyEntry(source, entry.id)}
            className="grid h-9 w-9 place-items-center rounded-lg border border-red-800/45 bg-red-950/25 text-red-200 hover:border-red-400/60 hover:bg-red-900/35"
            title="Remove from party inventory"
            aria-label="Remove from party inventory"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    </div>
  );

  if (!authState.uid) {
    return (
      <div className="rounded-2xl border border-sky-900/40 bg-black/30 p-8 text-sky-100">
        Please sign in with Google to use Campaigns.
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-120px)] rounded-2xl border border-sky-900/40 bg-[#06111f] p-6 text-sky-50 shadow-2xl">
      <div className="mb-6 rounded-2xl border border-sky-800/35 bg-black/40 p-5">
        <p className="text-xs uppercase tracking-[0.28em] text-cyan-300/80" style={{ fontFamily: "'Cinzel', serif" }}>Inoraxium Tools</p>
        <h2 className="mt-2 text-3xl font-bold text-sky-100" style={{ fontFamily: "'Cinzel', serif" }}>Campaigns</h2>
        <p className="mt-2 max-w-3xl text-sm text-sky-100/65">
          Create campaigns, invite players, organize parties, and keep shared party inventory separate from character sheets.
        </p>
        {statusMessage && <p className="mt-3 text-sm text-cyan-200/80">{statusMessage}</p>}
      </div>

      {!selectedCampaign ? (
        <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <section className="rounded-2xl border border-sky-900/40 bg-black/30 p-5">
            <h3 className="mb-4 text-xl font-bold text-sky-100" style={{ fontFamily: "'Cinzel', serif" }}>Create a Campaign</h3>
            <input
              value={newCampaignName}
              onChange={(event) => setNewCampaignName(event.target.value)}
              placeholder="Campaign name"
              className="mb-3 w-full rounded-lg border border-sky-900/55 bg-stone-950/70 px-3 py-2 text-sm text-sky-50 outline-none focus:border-cyan-400"
            />
            <button onClick={handleCreateCampaign} disabled={isBusy} className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-700/55 bg-cyan-950/35 px-4 py-3 text-sm font-bold text-cyan-100 hover:bg-cyan-900/45 disabled:opacity-50">
              <Plus size={16} /> Create a Campaign
            </button>
          </section>

          <section className="rounded-2xl border border-sky-900/40 bg-black/30 p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="text-xl font-bold text-sky-100" style={{ fontFamily: "'Cinzel', serif" }}>Your Campaigns</h3>
              <button onClick={refreshCampaigns} className="rounded-lg border border-sky-800/45 px-3 py-2 text-xs text-sky-200 hover:bg-sky-900/30">
                <RefreshCw size={14} />
              </button>
            </div>
            <div className="space-y-3">
              {campaigns.length === 0 ? (
                <p className="rounded-xl border border-dashed border-sky-900/45 p-6 text-center text-sky-100/45">No campaigns yet.</p>
              ) : campaigns.map((campaign) => (
                <div key={campaign.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-900/35 bg-black/25 p-4">
                  <div>
                    <h4 className="font-bold text-sky-100" style={{ fontFamily: "'Cinzel', serif" }}>{campaign.name}</h4>
                    <p className="text-xs text-sky-100/45">{campaign.dmUserIds.includes(authState.uid!) ? 'DM' : 'Player'} • {campaign.members.length} users</p>
                  </div>
                  <button onClick={() => setSelectedCampaignId(campaign.id)} className="rounded-lg border border-amber-700/50 bg-amber-950/30 px-4 py-2 text-sm text-amber-100 hover:bg-amber-900/40">
                    Load
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : !selectedParty ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <main className="space-y-6">
            <section className="rounded-2xl border border-sky-900/40 bg-black/30 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <button onClick={() => setSelectedCampaignId(null)} className="mb-3 text-sm text-cyan-300 hover:text-cyan-100">← Back to campaigns</button>
                  <h3 className="text-3xl font-bold text-sky-100" style={{ fontFamily: "'Cinzel', serif" }}>{selectedCampaign.name}</h3>
                  <p className="mt-1 text-sm text-sky-100/55">Role: {isSelectedCampaignDm ? 'DM' : 'Player'}</p>
                </div>
                <button onClick={handleCopyInvite} className="inline-flex items-center gap-2 rounded-xl border border-cyan-700/55 bg-cyan-950/35 px-4 py-2 text-sm font-bold text-cyan-100 hover:bg-cyan-900/45">
                  <Copy size={15} /> Invite
                </button>
              </div>
            </section>

            <section className="rounded-2xl border border-sky-900/40 bg-black/30 p-5">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h3 className="text-xl font-bold text-sky-100" style={{ fontFamily: "'Cinzel', serif" }}>Party List</h3>
                  <p className="text-sm text-sky-100/45">Parties start private. DM and party creator can see private parties.</p>
                </div>
                <div className="flex gap-2">
                  <input value={newPartyName} onChange={(event) => setNewPartyName(event.target.value)} placeholder="Party name" className="rounded-lg border border-sky-900/55 bg-stone-950/70 px-3 py-2 text-sm text-sky-50 outline-none focus:border-cyan-400" />
                  <button onClick={handleCreateParty} disabled={isBusy} className="rounded-lg border border-cyan-700/55 bg-cyan-950/35 px-4 py-2 text-sm font-bold text-cyan-100 hover:bg-cyan-900/45 disabled:opacity-50">Create a Party</button>
                </div>
              </div>
              <div className="space-y-3">
                {parties.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-sky-900/45 p-6 text-center text-sky-100/45">No parties yet.</p>
                ) : parties.map((party) => (
                  <div key={party.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-900/35 bg-black/25 p-4">
                    <div>
                      <h4 className="font-bold text-sky-100" style={{ fontFamily: "'Cinzel', serif" }}>{party.name}</h4>
                      <p className="text-xs text-sky-100/45">{party.visibility} • {party.characterIds.length} characters</p>
                    </div>
                    <button onClick={() => setSelectedPartyId(party.id)} className="rounded-lg border border-amber-700/50 bg-amber-950/30 px-4 py-2 text-sm text-amber-100 hover:bg-amber-900/40">
                      Load
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </main>

          <aside className="rounded-2xl border border-sky-900/40 bg-black/30 p-5">
            <h3 className="mb-4 text-xl font-bold text-sky-100" style={{ fontFamily: "'Cinzel', serif" }}>User List</h3>
            <div className="space-y-2">
              {selectedCampaign.members.map((member) => (
                <div key={member.uid} className="flex items-center justify-between gap-3 rounded-xl border border-sky-900/30 bg-black/25 p-3">
                  <div className="min-w-0">
                    <p className="truncate font-bold text-sky-100">{member.displayName || member.email || member.uid}</p>
                    <p className="truncate text-xs text-sky-100/45">{member.email || member.uid}</p>
                  </div>
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs ${member.role === 'dm' ? 'border-amber-600/50 text-amber-200' : 'border-sky-700/50 text-sky-200'}`}>
                    {member.role === 'dm' ? <Crown size={12} /> : <Eye size={12} />} {member.role}
                  </span>
                </div>
              ))}
            </div>
          </aside>
        </div>
      ) : (
        <div className="space-y-6">
          <section className="rounded-2xl border border-sky-900/40 bg-black/30 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <button onClick={() => setSelectedPartyId(null)} className="mb-3 text-sm text-cyan-300 hover:text-cyan-100">← Back to campaign</button>
                <h3 className="text-3xl font-bold text-sky-100" style={{ fontFamily: "'Cinzel', serif" }}>{selectedParty.name}</h3>
                <p className="mt-1 text-sm text-sky-100/55">{selectedCampaign.name} • {selectedParty.visibility}</p>
              </div>
              <button onClick={handleTogglePartyVisibility} className="rounded-xl border border-sky-800/45 bg-black/30 px-4 py-2 text-sm text-sky-100 hover:bg-sky-900/30">
                Make {selectedParty.visibility === 'public' ? 'Private' : 'Public'}
              </button>
            </div>
          </section>

          <div className="rounded-2xl border border-sky-900/40 bg-black/30 p-3">
            <div className="flex flex-wrap gap-2">
              {[
                { key: 'characters', label: 'Characters', icon: <Users size={15} /> },
                { key: 'inventory', label: 'Party Inventory', icon: <Backpack size={15} /> },
                { key: 'spells', label: 'Spells', icon: <Sparkles size={15} /> },
                { key: 'statuses', label: 'Statuses', icon: <Shield size={15} /> },
              ].map((tab) => (
                <button key={tab.key} onClick={() => setPartyTab(tab.key as PartyTab)} className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-bold ${partyTab === tab.key ? 'border-amber-400/60 bg-amber-950/40 text-amber-100' : 'border-sky-900/50 bg-black/20 text-sky-100/55 hover:text-sky-100'}`} style={{ fontFamily: "'Cinzel', serif" }}>
                  {tab.icon} {tab.label}
                </button>
              ))}
            </div>
          </div>

          {partyTab === 'characters' && (
            <section className="rounded-2xl border border-sky-900/40 bg-black/30 p-5">
              <h3 className="mb-4 text-xl font-bold text-sky-100" style={{ fontFamily: "'Cinzel', serif" }}>Characters</h3>
              {addableCharacters.length > 0 && (
                <div className="mb-5 flex flex-wrap gap-2">
                  {addableCharacters.map((character) => (
                    <button key={character.id} onClick={() => handleAddCharacter(character.id)} className="inline-flex items-center gap-2 rounded-lg border border-cyan-700/45 bg-cyan-950/25 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-900/35">
                      <Plus size={14} /> {character.name}
                    </button>
                  ))}
                </div>
              )}
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {partyCharacters.map((character) => (
                  <button
                    key={character.id}
                    onClick={() => openHomebrewCharacterSheet(character.id)}
                    className="grid grid-cols-[44px_1fr] items-center gap-3 rounded-xl border border-sky-900/35 bg-black/25 p-4 text-left transition-all hover:border-cyan-500/55 hover:bg-cyan-950/20"
                  >
                    <div className="grid h-11 w-11 place-items-center overflow-hidden rounded-lg border border-sky-800/40 bg-sky-950/40 text-xs font-bold text-sky-200">
                      {character.portraitUrl ? (
                        <img src={character.portraitUrl} alt={character.name} className="h-full w-full object-cover" />
                      ) : (
                        character.name.slice(0, 2).toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0">
                      <h4 className="truncate font-bold text-sky-100" style={{ fontFamily: "'Cinzel', serif" }}>{character.name}</h4>
                      <p className="truncate text-sm italic text-sky-100/55">{character.race} • {character.className}</p>
                      <p className="mt-1 text-xs text-cyan-200/55">Open homebrew sheet</p>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {partyTab === 'inventory' && (
            <section className="space-y-3">
              {((selectedParty.generalItems || []).length === 0 && (selectedParty.inventory || []).length === 0)
                ? <p className="rounded-xl border border-dashed border-sky-900/45 bg-black/25 p-6 text-center text-sky-100/45">Party inventory is empty.</p>
                : [
                    ...(selectedParty.generalItems || []).map((entry) => ({ entry, source: 'general-item' as const })),
                    ...(selectedParty.inventory || []).map((entry) => ({ entry, source: 'inventory-item' as const })),
                  ].map(({ entry, source }) => renderEntryCard('item', entry, source))}
            </section>
          )}

          {partyTab === 'spells' && (
            <section className="space-y-3">
              {(selectedParty.spells || []).length === 0
                ? <p className="rounded-xl border border-dashed border-sky-900/45 bg-black/25 p-6 text-center text-sky-100/45">No party spells yet.</p>
                : (selectedParty.spells || []).map((entry) => renderEntryCard('spell', entry, 'spell'))}
            </section>
          )}

          {partyTab === 'statuses' && (
            <section className="space-y-3">
              {(selectedParty.statuses || []).length === 0
                ? <p className="rounded-xl border border-dashed border-sky-900/45 bg-black/25 p-6 text-center text-sky-100/45">No party statuses yet.</p>
                : (selectedParty.statuses || []).map((entry) => renderEntryCard('status', entry, 'status'))}
            </section>
          )}
        </div>
      )}
    </div>
  );
};

export default CampaignsPage;
