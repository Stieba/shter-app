"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../lib/supabaseClient";

const MONTH_NAMES = [
  "januari", "februari", "maart", "april", "mei", "juni",
  "juli", "augustus", "september", "oktober", "november", "december"
];
const DAY_NAMES = ["ma", "di", "wo", "do", "vr", "za", "zo"];
const DAY_NAMES_FULL = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];

function pad(n) { return n.toString().padStart(2, "0"); }
function dateKey(y, m, d) { return `${y}-${pad(m + 1)}-${pad(d)}`; }
function parseDateKey(key) {
  const [y, m, d] = key.split("-").map((v) => parseInt(v, 10));
  return new Date(y, m - 1, d);
}
function todayKey() {
  const t = new Date();
  return dateKey(t.getFullYear(), t.getMonth(), t.getDate());
}
function formatNice(key) {
  const [, m, d] = key.split("-");
  return `${parseInt(d)} ${MONTH_NAMES[parseInt(m) - 1]}`;
}
function keysInRange(startKey, endKey) {
  let start = parseDateKey(startKey);
  let end = parseDateKey(endKey);
  if (start > end) { const tmp = start; start = end; end = tmp; }
  const out = [];
  const cur = new Date(start);
  while (cur <= end) {
    out.push(dateKey(cur.getFullYear(), cur.getMonth(), cur.getDate()));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}
function getMonthGrid(year, month) {
  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}
function makeICSUrl(date, time, label, songTitles) {
  const params = new URLSearchParams({ date, time, ...(label ? { label } : {}), ...(songTitles?.length ? { songs: songTitles.join(", ") } : {}) });
  return `/api/cal?${params.toString()}`;
}
function makeGCalUrl(date, time, label) {
  const [y, mo, d] = date.split("-");
  const [h, mi] = time.split(":");
  const p2 = (n) => String(n).padStart(2, "0");
  const start = `${y}${p2(mo)}${p2(d)}T${p2(h)}${p2(mi)}00`;
  const endH = String(parseInt(h) + 2).padStart(2, "0");
  const end = `${y}${p2(mo)}${p2(d)}T${endH}${p2(mi)}00`;
  const title = encodeURIComponent(label ? `SHTER repetitie — ${label}` : "SHTER repetitie");
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${start}/${end}`;
}
function fileIcon(name) {
  const ext = (name || "").split(".").pop().toLowerCase();
  if (["mp4", "mov", "avi", "mkv", "webm"].includes(ext)) return "🎬";
  if (["mp3", "wav", "aac", "flac", "m4a"].includes(ext)) return "🎵";
  if (ext === "pdf") return "📄";
  return "📎";
}

export default function ShterKalender() {
  const [members, setMembers] = useState([]);
  const [currentMember, setCurrentMember] = useState(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth());
  const [blocks, setBlocks] = useState({});
  const [proposals, setProposals] = useState({});
  const [songs, setSongs] = useState([]);
  const [songDocs, setSongDocs] = useState({});
  const [songProposals, setSongProposals] = useState([]);
  const [rehearsalSongs, setRehearsalSongs] = useState({});
  const [editingProposal, setEditingProposal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState(null);
  const [saving, setSaving] = useState(false);
  const [selectedDay, setSelectedDay] = useState(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [newMemberDraft, setNewMemberDraft] = useState("");
  const [showAddMember, setShowAddMember] = useState(false);
  const [rangeMode, setRangeMode] = useState(false);
  const [rangeStart, setRangeStart] = useState(null);
  const [rangeEnd, setRangeEnd] = useState(null);
  const [rangeNote, setRangeNote] = useState("");
  const [proposalTimeDraft, setProposalTimeDraft] = useState("20:00");
  const [proposalLabelDraft, setProposalLabelDraft] = useState("");
  const [showUpcoming, setShowUpcoming] = useState(false);
  const [showSetlist, setShowSetlist] = useState(false);
  const [dragIdx, setDragIdx] = useState(null);
  const [openDocsFor, setOpenDocsFor] = useState(null);
  const [linkDrafts, setLinkDrafts] = useState({});
  const [showProposeForm, setShowProposeForm] = useState(false);
  const [proposeDraft, setProposeDraft] = useState({ title: "", artist: "", motivation: "", spotify_url: "", youtube_url: "" });
  const bannerTimer = useRef(null);

  function flashBanner(text, tone = "ok") {
    setBanner({ text, tone });
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    bannerTimer.current = setTimeout(() => setBanner(null), 3000);
  }

  const loadAll = useCallback(async () => {
    const [
      { data: memberRows, error: mErr },
      { data: blockRows, error: bErr },
      { data: propRows, error: pErr },
      { data: songRows, error: sErr },
      { data: docRows, error: dErr },
      { data: spRows, error: spErr },
      { data: rsRows },
    ] = await Promise.all([
      supabase.from("members").select("*").order("sort_order"),
      supabase.from("blocks").select("*"),
      supabase.from("proposals").select("*"),
      supabase.from("songs").select("*").order("sort_order"),
      supabase.from("song_documents").select("*").order("created_at"),
      supabase.from("song_proposals").select("*").order("created_at"),
      supabase.from("rehearsal_songs").select("*"),
    ]);

    if (mErr || bErr || pErr || sErr || dErr || spErr) {
      flashBanner("Kon gegevens niet laden", "err");
      return;
    }

    setMembers(memberRows || []);
    setSongs(songRows || []);
    setSongProposals(spRows || []);

    const rsMap = {};
    for (const row of rsRows || []) {
      if (!rsMap[row.proposal_id]) rsMap[row.proposal_id] = [];
      rsMap[row.proposal_id].push(row.song_id);
    }
    setRehearsalSongs(rsMap);

    const docsMap = {};
    for (const row of docRows || []) {
      const key = String(row.song_id);
      if (!docsMap[key]) docsMap[key] = [];
      docsMap[key].push(row);
    }
    setSongDocs(docsMap);

    const blockMap = {};
    for (const row of blockRows || []) {
      if (!blockMap[row.date]) blockMap[row.date] = {};
      blockMap[row.date][row.member_name] = row.note || "";
    }
    setBlocks(blockMap);

    const propMap = {};
    for (const row of propRows || []) {
      if (!propMap[row.date]) propMap[row.date] = [];
      propMap[row.date].push({ id: row.id, time: row.time, label: row.label || "", by: row.proposed_by, confirmed: row.confirmed });
    }
    setProposals(propMap);
  }, []);

  useEffect(() => {
    (async () => { await loadAll(); setLoading(false); })();
    const channel = supabase.channel("shter-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "blocks" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "proposals" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "members" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "songs" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "song_documents" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "song_proposals" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "rehearsal_songs" }, loadAll)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadAll]);

  async function uploadAvatar(memberName, file) {
    const ext = file.name.split(".").pop();
    const path = `${memberName.replace(/\s+/g, "_")}.${ext}`;
    const { error: upErr } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
    if (upErr) { flashBanner("Foto uploaden mislukt", "err"); return; }
    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    await supabase.from("members").update({ avatar_url: data.publicUrl + "?t=" + Date.now() }).eq("name", memberName);
    flashBanner("Profielfoto opgeslagen!", "ok");
    await loadAll();
  }

  async function uploadDocument(songId, file) {
    setSaving(true);
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const path = `song-${songId}-${timestamp}-${safeName}`;
    const { error: upErr } = await supabase.storage.from("documents").upload(path, file, { upsert: false });
    if (upErr) { flashBanner("Uploaden mislukt: " + upErr.message, "err"); setSaving(false); return; }
    const { data } = supabase.storage.from("documents").getPublicUrl(path);
    const { error: dbErr } = await supabase.from("song_documents").insert({ song_id: songId, name: file.name, url: data.publicUrl });
    if (dbErr) { flashBanner("Opslaan mislukt", "err"); setSaving(false); return; }
    setSaving(false);
    flashBanner(`"${file.name}" geüpload!`, "ok");
    await loadAll();
  }

  async function deleteDocument(docId) {
    await supabase.from("song_documents").delete().eq("id", docId);
    await loadAll();
  }

  async function saveSongLink(songId, field, url) {
    await supabase.from("songs").update({ [field]: url || null }).eq("id", songId);
    await loadAll();
  }

  async function toggleRehearsalSong(proposalId, songId, checked) {
    if (checked) {
      await supabase.from("rehearsal_songs").insert({ proposal_id: proposalId, song_id: songId });
    } else {
      await supabase.from("rehearsal_songs").delete().eq("proposal_id", proposalId).eq("song_id", songId);
    }
    await loadAll();
  }

  async function updateProposal(id, time, label) {
    await supabase.from("proposals").update({ time, label: label || "" }).eq("id", id);
    setEditingProposal(null);
    await loadAll();
  }

  const STATUS_CYCLE = ["leren", "bijna klaar", "performance ready"];
  const STATUS_STYLE = {
    "leren":              { color: "#D17555", bg: "#2E1A10", border: "#D1755544" },
    "bijna klaar":        { color: "#B5944B", bg: "#251E0D", border: "#B5944B44" },
    "performance ready":  { color: "#6F8068", bg: "#1A2618", border: "#6F806844" },
  };
  async function cycleSongStatus(song) {
    const idx = STATUS_CYCLE.indexOf(song.status || "leren");
    const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
    await supabase.from("songs").update({ status: next }).eq("id", song.id);
    await loadAll();
  }

  async function addSongProposal() {
    const { title, artist, motivation, spotify_url, youtube_url } = proposeDraft;
    if (!title.trim() || !artist.trim()) { flashBanner("Titel en artiest zijn verplicht", "err"); return; }
    setSaving(true);
    const { error } = await supabase.from("song_proposals").insert({
      title: title.trim(), artist: artist.trim(),
      motivation: motivation.trim() || null,
      spotify_url: spotify_url.trim() || null,
      youtube_url: youtube_url.trim() || null,
      proposed_by: currentMember,
    });
    setSaving(false);
    if (error) { flashBanner("Voorstel mislukt", "err"); return; }
    setProposeDraft({ title: "", artist: "", motivation: "", spotify_url: "", youtube_url: "" });
    setShowProposeForm(false);
    flashBanner("Voorstel toegevoegd!", "ok");
    await loadAll();
  }

  async function deleteSongProposal(id) {
    await supabase.from("song_proposals").delete().eq("id", id);
    await loadAll();
  }

  async function approveSongProposal(sp) {
    setSaving(true);
    const maxOrder = songs.length > 0 ? Math.max(...songs.map(s => s.sort_order)) + 1 : 0;
    await supabase.from("songs").insert({ title: sp.title, artist: sp.artist, sort_order: maxOrder, spotify_url: sp.spotify_url, youtube_url: sp.youtube_url });
    await supabase.from("song_proposals").delete().eq("id", sp.id);
    setSaving(false);
    flashBanner(`"${sp.title}" toegevoegd aan setlist!`, "ok");
    await loadAll();
  }

  async function reorderSongs(newOrder) {
    setSongs(newOrder);
    await Promise.all(newOrder.map((s, i) => supabase.from("songs").update({ sort_order: i }).eq("id", s.id)));
  }

  async function toggleBlock(key, note) {
    if (!currentMember) return;
    setSaving(true);
    const alreadyBlocked = blocks[key]?.[currentMember] !== undefined;
    if (alreadyBlocked) {
      const { error } = await supabase.from("blocks").delete().eq("date", key).eq("member_name", currentMember);
      if (error) flashBanner("Deblokkeren mislukt", "err");
    } else {
      const { error } = await supabase.from("blocks").upsert({ date: key, member_name: currentMember, note: note || "" }, { onConflict: "date,member_name" });
      if (error) flashBanner("Blokkeren mislukt", "err");
    }
    setSaving(false);
    await loadAll();
  }

  async function blockRange(startKey, endKey, note) {
    if (!currentMember) return;
    setSaving(true);
    const days = keysInRange(startKey, endKey);
    const { error } = await supabase.from("blocks").upsert(
      days.map((d) => ({ date: d, member_name: currentMember, note: note || "" })),
      { onConflict: "date,member_name" }
    );
    setSaving(false);
    if (error) flashBanner("Blokkeren mislukt", "err");
    else flashBanner(`${days.length} dag${days.length === 1 ? "" : "en"} geblokkeerd`, "ok");
    await loadAll();
  }

  async function addProposal() {
    if (!selectedDay || !currentMember || !proposalTimeDraft) return;
    setSaving(true);
    const { error } = await supabase.from("proposals").insert({
      date: selectedDay, time: proposalTimeDraft, label: proposalLabelDraft.trim(), proposed_by: currentMember, confirmed: false,
    });
    setSaving(false);
    if (error) flashBanner("Voorstel toevoegen mislukt", "err");
    setProposalLabelDraft("");
    await loadAll();
  }

  async function toggleConfirmProposal(id, currentlyConfirmed) {
    setSaving(true);
    const { error } = await supabase.from("proposals").update({ confirmed: !currentlyConfirmed }).eq("id", id);
    setSaving(false);
    if (error) flashBanner("Bijwerken mislukt", "err");
    await loadAll();
  }

  async function removeProposal(id) {
    setSaving(true);
    await supabase.from("proposals").delete().eq("id", id);
    setSaving(false);
    await loadAll();
  }

  async function addMember() {
    const name = newMemberDraft.trim();
    if (!name || members.some((m) => m.name === name) || members.length >= 10) return;
    const palette = ["#C9744A", "#8A6A4F", "#B5944B", "#6F8068", "#A35238", "#7A6A8A", "#C2A05E", "#5E7A78", "#9C5B4A", "#80724F"];
    const { error } = await supabase.from("members").insert({ name, color: palette[members.length % palette.length], sort_order: members.length });
    if (error) { flashBanner("Toevoegen mislukt", "err"); return; }
    setNewMemberDraft(""); setShowAddMember(false);
    await loadAll();
  }

  function openDay(key) {
    if (rangeMode) {
      if (!rangeStart || (rangeStart && rangeEnd)) { setRangeStart(key); setRangeEnd(null); }
      else setRangeEnd(key);
      return;
    }
    setSelectedDay(key); setNoteDraft(blocks[key]?.[currentMember] || "");
    setProposalTimeDraft("20:00"); setProposalLabelDraft("");
  }
  function closeDay() { setSelectedDay(null); setNoteDraft(""); }
  function confirmDayAction() { if (!selectedDay) return; toggleBlock(selectedDay, noteDraft); closeDay(); }
  function confirmRange() {
    if (!rangeStart || !rangeEnd) return;
    blockRange(rangeStart, rangeEnd, rangeNote);
    setRangeStart(null); setRangeEnd(null); setRangeNote(""); setRangeMode(false);
  }
  function cancelRange() { setRangeStart(null); setRangeEnd(null); setRangeNote(""); setRangeMode(false); }
  function prevMonth() { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); }
  function nextMonth() { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); }
  function onDragStart(idx) { setDragIdx(idx); }
  function onDragOver(e, idx) {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    const next = [...songs];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(idx, 0, moved);
    setDragIdx(idx); setSongs(next);
  }
  function onDragEnd() { reorderSongs(songs); setDragIdx(null); }

  if (loading) {
    return (
      <div style={s.loadingScreen}>
        <div style={s.loadingMark}>S</div>
        <div style={{ color: "#A8916F", fontFamily: "monospace", fontSize: 13 }}>laden…</div>
      </div>
    );
  }

  const colorFor = (name) => members.find((m) => m.name === name)?.color || "#8A7A60";
  const avatarFor = (name) => members.find((m) => m.name === name)?.avatar_url || null;

  if (!currentMember) {
    return (
      <div style={s.app}>
        <div style={s.bgPoster} />
        <div style={s.identityScreen}>
          <div style={s.logo}>SHTER</div>
          <div style={s.logoSub}>★ jongûh! tour ★ bandplanning</div>
          <div style={s.identityPrompt}>wie ben jij?</div>
          <div style={s.memberGrid}>
            {members.map((m) => (
              <div key={m.id} style={s.memberPickRow}>
                <button onClick={() => setCurrentMember(m.name)} style={{ ...s.memberPick, borderColor: m.color }}>
                  {m.avatar_url
                    ? <img src={m.avatar_url} alt={m.name} style={s.avatarMed} />
                    : <span style={{ ...s.avatarPlaceholder, background: m.color + "44", color: m.color }}>{m.name[0].toUpperCase()}</span>
                  }
                  <span style={s.memberPickName}>{m.name}</span>
                </button>
                <label style={s.avatarUploadBtn} title="profielfoto uploaden">
                  📷
                  <input type="file" accept="image/*" style={{ display: "none" }}
                    onChange={(e) => { if (e.target.files[0]) uploadAvatar(m.name, e.target.files[0]); }} />
                </label>
              </div>
            ))}
          </div>
          {members.length < 10 && <button style={s.ghostBtn} onClick={() => setShowAddMember(true)}>+ lid toevoegen</button>}
          {showAddMember && (
            <div style={s.inlineAdd}>
              <input autoFocus value={newMemberDraft} onChange={(e) => setNewMemberDraft(e.target.value)}
                placeholder="naam" style={s.input} onKeyDown={(e) => { if (e.key === "Enter") addMember(); }} />
              <button style={s.smallBtn} onClick={addMember}>toevoegen</button>
            </div>
          )}
          {banner && <div style={{ ...(banner.tone === "err" ? s.toastStaticErr : s.toastStaticOk), marginTop: 16 }}>{banner.text}</div>}
        </div>
      </div>
    );
  }

  const grid = getMonthGrid(year, month);
  const myColor = colorFor(currentMember);
  const myAvatar = avatarFor(currentMember);
  const tKey = todayKey();
  const rangeSet = rangeStart && rangeEnd ? new Set(keysInRange(rangeStart, rangeEnd)) : null;

  return (
    <div style={s.app}>
      <div style={s.bgPoster} />

      <header style={s.header}>
        <div>
          <div style={s.logoSmall}>SHTER</div>
          <div style={s.headerSub}>bandplanning</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button style={s.setlistHeaderBtn} onClick={() => setShowSetlist(true)}>♪ setlist</button>
          <button style={{ ...s.youBadge, borderColor: myColor }} onClick={() => setCurrentMember(null)}>
            {myAvatar ? <img src={myAvatar} alt={currentMember} style={s.avatarBadge} /> : <span style={{ ...s.dot, background: myColor }} />}
            {currentMember}
          </button>
        </div>
      </header>

      <div style={s.monthNav}>
        <button style={s.navBtn} onClick={prevMonth}>‹</button>
        <div style={s.monthLabel}>{MONTH_NAMES[month]} {year}</div>
        <button style={s.navBtn} onClick={nextMonth}>›</button>
      </div>

      <div style={s.toolRow}>
        {!rangeMode
          ? <button style={s.toolBtn} onClick={() => setRangeMode(true)}>van — tot blokkeren</button>
          : (
            <div style={s.rangeBar}>
              <span style={s.rangeBarText}>
                {!rangeStart && "kies startdag"}
                {rangeStart && !rangeEnd && `start: ${formatNice(rangeStart)} — kies einddag`}
                {rangeStart && rangeEnd && `${formatNice(rangeStart)} → ${formatNice(rangeEnd)}`}
              </span>
              <button style={s.rangeCancelBtn} onClick={cancelRange}>annuleren</button>
            </div>
          )
        }
      </div>

      {rangeMode && rangeStart && rangeEnd && (
        <div style={s.rangeConfirmBox}>
          <input value={rangeNote} onChange={(e) => setRangeNote(e.target.value)} placeholder="notitie (optioneel)" style={s.noteInput} />
          <button style={{ ...s.sheetMainBtn, background: myColor, marginTop: 8 }} onClick={confirmRange}>
            {keysInRange(rangeStart, rangeEnd).length} dagen blokkeren
          </button>
        </div>
      )}

      <div style={s.dayHeaderRow}>
        {DAY_NAMES.map((d) => <div key={d} style={s.dayHeaderCell}>{d}</div>)}
      </div>

      <div style={s.grid}>
        {grid.map((d, idx) => {
          if (d === null) return <div key={`e-${idx}`} style={s.emptyCell} />;
          const key = dateKey(year, month, d);
          const dayBlocks = blocks[key] || {};
          const blockedNames = Object.keys(dayBlocks);
          const iAmBlocked = blockedNames.includes(currentMember);
          const isToday = key === tKey;
          const dayProposals = proposals[key] || [];
          const inRange = (rangeStart === key && !rangeEnd) || (rangeSet && rangeSet.has(key));
          const hasConfirmed = dayProposals.some((p) => p.confirmed);
          const hasProposal = dayProposals.length > 0 && !hasConfirmed;

          return (
            <button key={key} onClick={() => openDay(key)} style={{
              ...s.dayCell,
              ...(isToday ? s.todayCell : {}),
              ...(iAmBlocked ? { background: myColor + "30" } : {}),
              ...(hasProposal ? { background: "#332500", borderColor: "#B5944B", borderWidth: 2 } : {}),
              ...(hasConfirmed ? { background: "#0F2918", borderColor: "#4A9060", borderWidth: 2 } : {}),
              ...(inRange ? { background: myColor + "55", borderColor: myColor, borderWidth: 2 } : {}),
            }}>
              <span style={s.dayNum}>{d}</span>
              <div style={s.pillRow}>
                {blockedNames.slice(0, 4).map((name) => (
                  <span key={name} style={{ ...s.pill, background: colorFor(name) }} />
                ))}
                {blockedNames.length > 4 && <span style={s.pillMore}>+{blockedNames.length - 4}</span>}
              </div>
            </button>
          );
        })}
      </div>

      {/* Legenda: avatar + kleurbol + naam */}
      <div style={s.legend}>
        {members.map((m) => (
          <div key={m.id} style={s.legendItem}>
            {m.avatar_url && <img src={m.avatar_url} alt={m.name} style={s.avatarTiny} />}
            <span style={{ ...s.dot, background: m.color }} />
            <span style={{ opacity: m.name === currentMember ? 1 : 0.6 }}>{m.name}</span>
          </div>
        ))}
        <div style={s.legendItem}><span style={{ ...s.proposalMark, fontSize: 10 }}>◎</span><span style={{ opacity: 0.6, fontSize: 12 }}>voorstel</span></div>
        <div style={s.legendItem}><span style={{ ...s.confirmedMark, fontSize: 10 }}>●</span><span style={{ opacity: 0.6, fontSize: 12 }}>definitief</span></div>
      </div>

      {/* Aankomende repetities */}
      <div style={{ padding: "12px 18px 0", position: "relative", zIndex: 1 }}>
        <button style={s.upcomingBtn} onClick={() => setShowUpcoming(v => !v)}>
          {showUpcoming ? "▲" : "▼"} aankomende repetities
        </button>
        {showUpcoming && (() => {
          const tk = todayKey();
          const upcoming = Object.entries(proposals)
            .filter(([date]) => date >= tk)
            .sort(([a], [b]) => a.localeCompare(b))
            .flatMap(([date, props]) => props.map((p) => ({ date, ...p })));
          if (!upcoming.length) return <div style={s.upcomingEmpty}>geen aankomende repetities gepland</div>;
          return (
            <div style={s.upcomingList}>
              {upcoming.map((p) => {
                const [y, mo, d] = p.date.split("-");
                const dayOfWeek = DAY_NAMES_FULL[new Date(parseInt(y), parseInt(mo) - 1, parseInt(d)).getDay()];
                const dateStr = `${dayOfWeek} ${parseInt(d)} ${MONTH_NAMES[parseInt(mo) - 1]} ${y}`;
                return (
                  <div key={p.id} style={{ ...s.upcomingRow, ...(p.confirmed ? s.upcomingConfirmedRow : s.upcomingProposalRow) }}>
                    <div style={s.upcomingLeft}>
                      <span style={p.confirmed ? s.confirmedMark : s.proposalMark}>{p.confirmed ? "●" : "◎"}</span>
                      <div>
                        <div style={s.upcomingDate}>{dateStr}</div>
                        <div style={s.upcomingTime}>{p.time}{p.label ? ` — ${p.label}` : ""}</div>
                        <div style={s.upcomingBy}>door {p.by}</div>
                        {(() => {
                          const afwezig = Object.keys(blocks[p.date] || {});
                          if (!afwezig.length) return null;
                          return <div style={s.upcomingAbsent}>🚫 {afwezig.join(", ")}</div>;
                        })()}
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
                      <span style={p.confirmed ? s.tagConfirmed : s.tagProposal}>{p.confirmed ? "definitief" : "voorstel"}</span>
                      {(() => {
                        const rSongs = (rehearsalSongs[p.id] || []).map(sid => songs.find(s => s.id === sid)).filter(Boolean);
                        const songTitles = rSongs.map(s => s.title);
                        const [y, mo, d] = p.date.split("-");
                        const dow = DAY_NAMES_FULL[new Date(parseInt(y), parseInt(mo)-1, parseInt(d)).getDay()];
                        const dateLabel = `${dow} ${parseInt(d)} ${MONTH_NAMES[parseInt(mo)-1]}`;
                        const afwezig = Object.keys(blocks[p.date] || {});
                        let msg = `🎸 SHTER repetitie herinnering\n📅 ${dateLabel}\n🕐 ${p.time}${p.label ? `\n📍 ${p.label}` : ""}`;
                        if (songTitles.length) msg += `\n\n🎵 Nummers:\n${songTitles.map(t => `• ${t}`).join("\n")}`;
                        if (afwezig.length) msg += `\n\n🚫 Kan niet: ${afwezig.join(", ")}`;
                        return (
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                            {songTitles.length > 0 && (
                              <div style={{ width: "100%", fontSize: 11, color: "#8A7A60", marginBottom: 2 }}>
                                🎵 {songTitles.join(", ")}
                              </div>
                            )}
                            <a href={makeICSUrl(p.date, p.time, p.label, songTitles)} style={s.calBtn} title="Toevoegen aan iPhone/iCal agenda">📅 iCal</a>
                            <a href={makeGCalUrl(p.date, p.time, p.label)} target="_blank" rel="noreferrer" style={s.calBtn} title="Toevoegen aan Google agenda">📅 Google</a>
                            <a href={`https://wa.me/?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer"
                              style={{ ...s.calBtn, background: "#1A2B1A", borderColor: "#2A5A2A", color: "#5CB85C" }}
                              title="Stuur herinnering via WhatsApp">
                              💬 WhatsApp
                            </a>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>

      {saving && <div style={s.savingToast}>opslaan…</div>}
      {banner && <div style={banner.tone === "err" ? s.errorToast : s.okToast}>{banner.text}</div>}

      {/* Dag detail sheet */}
      {selectedDay && (
        <div style={s.sheetOverlay} onClick={closeDay}>
          <div style={s.sheet} onClick={(e) => e.stopPropagation()}>
            <div style={s.sheetHandle} />
            <div style={s.sheetDate}>
              {(() => { const [, mo, d] = selectedDay.split("-"); return `${parseInt(d)} ${MONTH_NAMES[parseInt(mo) - 1]} ${year}`; })()}
            </div>

            {/* Wie kan niet */}
            {Object.keys(blocks[selectedDay] || {}).length > 0 && (
              <div style={s.unavailableBox}>
                <div style={s.unavailableLabel}>🚫 kan niet</div>
                {Object.entries(blocks[selectedDay] || {}).map(([name, note]) => (
                  <div key={name} style={s.whoRow}>
                    {avatarFor(name)
                      ? <img src={avatarFor(name)} alt={name} style={s.avatarSmall} />
                      : <span style={{ ...s.dot, background: colorFor(name) }} />
                    }
                    <span style={{ ...s.whoName, color: colorFor(name) }}>{name}</span>
                    {note ? <span style={s.whoNote}>— {note}</span> : null}
                  </div>
                ))}
              </div>
            )}

            <div style={s.sheetActionLabel}>
              {blocks[selectedDay]?.[currentMember] !== undefined ? "Jij hebt deze dag geblokkeerd" : "Markeer als niet beschikbaar"}
            </div>
            {blocks[selectedDay]?.[currentMember] === undefined && (
              <input value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="notitie (optioneel)" style={s.noteInput} />
            )}
            <div style={s.sheetButtons}>
              <button style={{ ...s.sheetMainBtn, background: blocks[selectedDay]?.[currentMember] !== undefined ? "#3A3024" : myColor }} onClick={confirmDayAction}>
                {blocks[selectedDay]?.[currentMember] !== undefined ? "Deblokkeren" : "Blokkeren"}
              </button>
              <button style={s.sheetCancelBtn} onClick={closeDay}>Sluiten</button>
            </div>

            <div style={s.sheetDivider} />
            <div style={s.sheetActionLabel}>Repetitietijd voorstellen</div>
            {(proposals[selectedDay] || []).length > 0 && (
              <div style={s.proposalList}>
                {(proposals[selectedDay] || []).slice().sort((a, b) => a.time.localeCompare(b.time)).map((p) => {
                  const isEditing = editingProposal?.id === p.id;
                  const checkedSongs = rehearsalSongs[p.id] || [];
                  return (
                    <div key={p.id} style={{ ...s.proposalRow, ...(p.confirmed ? { borderColor: "#6F8068", background: "#1E2A1A" } : {}), flexDirection: "column", gap: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div style={s.proposalInfo}>
                          {isEditing ? (
                            <>
                              <input type="time" defaultValue={p.time} id={`edit-time-${p.id}`} style={{ ...s.noteInput, flex: "0 0 100px", fontSize: 13, padding: "4px 8px" }} />
                              <input defaultValue={p.label} id={`edit-label-${p.id}`} placeholder="locatie" style={{ ...s.noteInput, flex: 1, fontSize: 13, padding: "4px 8px" }} />
                            </>
                          ) : (
                            <>
                              <span style={s.proposalTime}>{p.time}</span>
                              {p.label && <span style={s.proposalLabel}>{p.label}</span>}
                              <span style={s.proposalBy}>door {p.by}</span>
                              {p.confirmed && <span style={s.proposalConfirmedTag}>definitief</span>}
                            </>
                          )}
                        </div>
                        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                          {isEditing ? (
                            <>
                              <button style={{ ...s.proposalConfirmBtn, background: myColor, color: "#1C1812" }}
                                onClick={() => updateProposal(p.id, document.getElementById(`edit-time-${p.id}`).value, document.getElementById(`edit-label-${p.id}`).value)}>
                                opslaan
                              </button>
                              <button style={s.proposalDeleteBtn} onClick={() => setEditingProposal(null)}>✕</button>
                            </>
                          ) : (
                            <>
                              <button style={{ ...s.proposalDeleteBtn, fontSize: 12 }} onClick={() => setEditingProposal({ id: p.id, time: p.time, label: p.label })}>✎</button>
                              <button style={{ ...s.proposalConfirmBtn, ...(p.confirmed ? { background: "#3A3024", color: "#EDE0CC" } : { background: myColor, color: "#1C1812" }) }}
                                onClick={() => toggleConfirmProposal(p.id, p.confirmed)}>
                                {p.confirmed ? "annuleer" : "maak definitief"}
                              </button>
                              <button style={s.proposalDeleteBtn} onClick={() => removeProposal(p.id)}>✕</button>
                            </>
                          )}
                        </div>
                      </div>
                      {songs.length > 0 && (
                        <div style={{ borderTop: "1px solid #2E2820", paddingTop: 8 }}>
                          <div style={{ fontSize: 11, color: "#8A7A60", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Nummers voor deze repetitie</div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            {songs.map((song) => {
                              const checked = checkedSongs.includes(song.id);
                              return (
                                <label key={song.id} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, color: checked ? "#EDE0CC" : "#8A7A60" }}>
                                  <input type="checkbox" checked={checked} onChange={(e) => toggleRehearsalSong(p.id, song.id, e.target.checked)}
                                    style={{ accentColor: myColor, width: 15, height: 15 }} />
                                  <span>{song.title}</span>
                                  <span style={{ fontSize: 11, opacity: 0.6 }}>— {song.artist}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <div style={s.proposalForm}>
              <input type="time" value={proposalTimeDraft} onChange={(e) => setProposalTimeDraft(e.target.value)} style={{ ...s.noteInput, flex: "0 0 110px" }} />
              <input value={proposalLabelDraft} onChange={(e) => setProposalLabelDraft(e.target.value)} placeholder="bv. studio, bij Bram" style={{ ...s.noteInput, flex: 1 }} />
            </div>
            <button style={{ ...s.ghostBtn, marginTop: 0, maxWidth: "none" }} onClick={addProposal}>+ voorstel toevoegen</button>
          </div>
        </div>
      )}

      {/* Setlist overlay */}
      {showSetlist && (
        <div style={s.sheetOverlay} onClick={() => { setShowSetlist(false); setOpenDocsFor(null); setShowProposeForm(false); }}>
          <div style={{ ...s.sheet, maxHeight: "92vh" }} onClick={(e) => e.stopPropagation()}>
            <div style={s.sheetHandle} />
            <div style={s.sheetDate}>♪ Setlist</div>
            <div style={{ fontSize: 12, color: "#8A7A60", fontFamily: "monospace" }}>sleep om volgorde aan te passen</div>

            {/* Bevestigde setlist */}
            <div style={s.setlistList}>
              {songs.map((song, idx) => {
                const docs = songDocs[String(song.id)] || [];
                const isOpen = openDocsFor === song.id;
                const draft = linkDrafts[song.id] || {};
                return (
                  <div key={song.id} draggable onDragStart={() => onDragStart(idx)}
                    onDragOver={(e) => onDragOver(e, idx)} onDragEnd={onDragEnd}
                    style={{ ...s.setlistRow, opacity: dragIdx === idx ? 0.5 : 1 }}>
                    <div style={s.setlistTop}>
                      <span style={s.setlistNum}>{idx + 1}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={s.setlistTitle}>{song.title}</div>
                        <div style={s.setlistArtist}>{song.artist}</div>
                      </div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        {(() => {
                          const st = song.status || "leren";
                          const ss = STATUS_STYLE[st];
                          return (
                            <button onClick={() => cycleSongStatus(song)}
                              style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: ss.color, background: ss.bg, border: `1px solid ${ss.border}`, borderRadius: 6, padding: "4px 8px", cursor: "pointer", whiteSpace: "nowrap" }}>
                              {st}
                            </button>
                          );
                        })()}
                        <button style={{ ...s.docsToggleBtn, ...(isOpen ? { background: "#3A3024", color: "#EDE0CC" } : {}) }}
                          onClick={() => setOpenDocsFor(isOpen ? null : song.id)}>
                          docs {docs.length > 0 ? `(${docs.length})` : ""}
                        </button>
                        <span style={s.dragHandle}>⠿</span>
                      </div>
                    </div>
                    {isOpen && (
                      <div style={s.docsPanel}>
                        {docs.length > 0 && (
                          <div style={s.docList}>
                            {docs.map((doc) => (
                              <div key={doc.id} style={s.docRow}>
                                <span style={s.docIcon}>{fileIcon(doc.name)}</span>
                                <a href={doc.url} download={doc.name} target="_blank" rel="noreferrer" style={s.docLink}>{doc.name}</a>
                                <button style={s.docDeleteBtn} onClick={() => deleteDocument(doc.id)}>✕</button>
                              </div>
                            ))}
                          </div>
                        )}
                        <label style={s.uploadArea}>
                          <span>+ bestand uploaden (PDF, video, audio…)</span>
                          <input type="file" style={{ display: "none" }}
                            onChange={(e) => { if (e.target.files[0]) uploadDocument(song.id, e.target.files[0]); }} />
                        </label>
                        <div style={s.linkRow}>
                          <span style={s.linkIcon}>🎵</span>
                          <input value={draft.spotify_url ?? (song.spotify_url || "")}
                            onChange={(e) => setLinkDrafts(p => ({ ...p, [song.id]: { ...p[song.id], spotify_url: e.target.value } }))}
                            onBlur={(e) => saveSongLink(song.id, "spotify_url", e.target.value)}
                            placeholder="Spotify link" style={s.linkInput} />
                          {song.spotify_url && <a href={song.spotify_url} target="_blank" rel="noreferrer" style={s.linkOpenBtn}>↗</a>}
                        </div>
                        <div style={s.linkRow}>
                          <span style={s.linkIcon}>▶</span>
                          <input value={draft.youtube_url ?? (song.youtube_url || "")}
                            onChange={(e) => setLinkDrafts(p => ({ ...p, [song.id]: { ...p[song.id], youtube_url: e.target.value } }))}
                            onBlur={(e) => saveSongLink(song.id, "youtube_url", e.target.value)}
                            placeholder="YouTube link" style={s.linkInput} />
                          {song.youtube_url && <a href={song.youtube_url} target="_blank" rel="noreferrer" style={s.linkOpenBtn}>↗</a>}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Scheiding: voorgestelde nummers */}
            <div style={s.proposalSectionHeader}>
              <div style={s.proposalSectionTitle}>💡 Voorgestelde nummers</div>
              <button style={s.proposeBtn} onClick={() => setShowProposeForm(v => !v)}>
                {showProposeForm ? "annuleer" : "+ nummer voorstellen"}
              </button>
            </div>

            {/* Voorstelformulier */}
            {showProposeForm && (
              <div style={s.proposeForm}>
                <input value={proposeDraft.title} onChange={(e) => setProposeDraft(d => ({ ...d, title: e.target.value }))}
                  placeholder="Titel *" style={s.noteInput} />
                <input value={proposeDraft.artist} onChange={(e) => setProposeDraft(d => ({ ...d, artist: e.target.value }))}
                  placeholder="Artiest *" style={s.noteInput} />
                <input value={proposeDraft.motivation} onChange={(e) => setProposeDraft(d => ({ ...d, motivation: e.target.value }))}
                  placeholder="Motivatie (waarom dit nummer?)" style={s.noteInput} />
                <input value={proposeDraft.spotify_url} onChange={(e) => setProposeDraft(d => ({ ...d, spotify_url: e.target.value }))}
                  placeholder="🎵 Spotify link (optioneel)" style={s.noteInput} />
                <input value={proposeDraft.youtube_url} onChange={(e) => setProposeDraft(d => ({ ...d, youtube_url: e.target.value }))}
                  placeholder="▶ YouTube link (optioneel)" style={s.noteInput} />
                <button style={{ ...s.sheetMainBtn, background: myColor }} onClick={addSongProposal}>
                  Voorstel indienen
                </button>
              </div>
            )}

            {/* Lijst voorgestelde nummers */}
            {songProposals.length === 0 && !showProposeForm && (
              <div style={s.upcomingEmpty}>nog geen voorgestelde nummers</div>
            )}
            <div style={s.setlistList}>
              {songProposals.map((sp) => (
                <div key={sp.id} style={s.songProposalRow}>
                  <div style={s.setlistTop}>
                    <span style={s.proposalBadge}>voorstel</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={s.setlistTitle}>{sp.title}</div>
                      <div style={s.setlistArtist}>{sp.artist}</div>
                      {sp.motivation && <div style={s.proposalMotivation}>"{sp.motivation}"</div>}
                      <div style={s.upcomingBy}>door {sp.proposed_by}</div>
                    </div>
                  </div>
                  <div style={s.songProposalActions}>
                    {sp.spotify_url && <a href={sp.spotify_url} target="_blank" rel="noreferrer" style={{ ...s.linkOpenBtn, fontSize: 12 }}>🎵 Spotify</a>}
                    {sp.youtube_url && <a href={sp.youtube_url} target="_blank" rel="noreferrer" style={{ ...s.linkOpenBtn, fontSize: 12 }}>▶ YouTube</a>}
                    <button style={s.approveBtn} onClick={() => approveSongProposal(sp)}>→ setlist</button>
                    <button style={s.docDeleteBtn} onClick={() => deleteSongProposal(sp.id)}>✕</button>
                  </div>
                </div>
              ))}
            </div>

            <button style={{ ...s.sheetCancelBtn, marginTop: 8 }} onClick={() => { setShowSetlist(false); setOpenDocsFor(null); setShowProposeForm(false); }}>Sluiten</button>
          </div>
        </div>
      )}
    </div>
  );
}

const s = {
  app: { minHeight: "100vh", background: "#1C1812", color: "#EDE0CC", fontFamily: "'Helvetica Neue', Arial, sans-serif", maxWidth: 480, margin: "0 auto", paddingBottom: 40, position: "relative" },
  bgPoster: { position: "fixed", inset: 0, backgroundImage: "url('/shter-poster.jpg')", backgroundSize: "cover", backgroundPosition: "center top", opacity: 0.07, zIndex: 0, pointerEvents: "none" },
  loadingScreen: { minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, background: "#1C1812" },
  loadingMark: { fontFamily: "'Arial Black', Impact, sans-serif", fontWeight: 900, fontSize: 48, color: "#C9744A" },
  identityScreen: { minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 20px", gap: 8, position: "relative", zIndex: 1 },
  logo: { fontFamily: "'Arial Black', Impact, sans-serif", fontWeight: 900, fontSize: 52, letterSpacing: 1, color: "#EDE0CC", textTransform: "uppercase", textShadow: "2px 2px 0 #3A2A1E" },
  logoSub: { fontFamily: "monospace", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "#A8916F", marginBottom: 28, textAlign: "center" },
  identityPrompt: { fontFamily: "monospace", fontSize: 13, letterSpacing: 2, textTransform: "uppercase", color: "#8A7A60", marginBottom: 14 },
  memberGrid: { display: "flex", flexDirection: "column", gap: 10, width: "100%", maxWidth: 340 },
  memberPickRow: { display: "flex", alignItems: "center", gap: 8 },
  memberPick: { display: "flex", alignItems: "center", gap: 12, background: "#2A2319", border: "1.5px solid", borderRadius: 12, color: "#EDE0CC", fontSize: 16, padding: "10px 14px", cursor: "pointer", textAlign: "left", flex: 1 },
  memberPickName: { fontWeight: 500 },
  avatarMed: { width: 38, height: 38, borderRadius: "50%", objectFit: "cover", flexShrink: 0 },
  avatarSmall: { width: 24, height: 24, borderRadius: "50%", objectFit: "cover", flexShrink: 0 },
  avatarTiny: { width: 14, height: 14, borderRadius: "50%", objectFit: "cover", flexShrink: 0 },
  avatarBadge: { width: 20, height: 20, borderRadius: "50%", objectFit: "cover", flexShrink: 0 },
  avatarPlaceholder: { width: 38, height: 38, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, flexShrink: 0 },
  avatarUploadBtn: { background: "#2A2319", border: "1px solid #4A3F2E", borderRadius: 8, padding: "10px 13px", cursor: "pointer", fontSize: 16, flexShrink: 0 },
  dot: { width: 10, height: 10, borderRadius: "50%", flexShrink: 0 },
  ghostBtn: { marginTop: 16, background: "transparent", border: "1px dashed #5A4E3A", borderRadius: 10, color: "#A8916F", fontSize: 14, padding: "10px 16px", cursor: "pointer", width: "100%", maxWidth: 340 },
  inlineAdd: { display: "flex", gap: 8, marginTop: 10, width: "100%", maxWidth: 340 },
  input: { flex: 1, background: "#2A2319", border: "1px solid #4A3F2E", borderRadius: 8, color: "#EDE0CC", padding: "10px 12px", fontSize: 14 },
  smallBtn: { background: "#C9744A", border: "none", borderRadius: 8, color: "#1C1812", fontWeight: 600, padding: "10px 14px", fontSize: 13, cursor: "pointer" },
  toastStaticOk: { background: "#26301F", border: "1px solid #6F8068", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#B6C7A8" },
  toastStaticErr: { background: "#2E1E18", border: "1px solid #A3523A", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#D17555" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 18px 8px", position: "relative", zIndex: 1 },
  logoSmall: { fontFamily: "'Arial Black', Impact, sans-serif", fontWeight: 900, fontSize: 24, color: "#EDE0CC", textTransform: "uppercase" },
  headerSub: { fontFamily: "monospace", fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: "#8A7A60" },
  youBadge: { display: "flex", alignItems: "center", gap: 6, background: "#2A2319", border: "1.5px solid", borderRadius: 999, color: "#EDE0CC", fontSize: 13, padding: "6px 12px", cursor: "pointer" },
  setlistHeaderBtn: { background: "transparent", border: "1px solid #3A3024", borderRadius: 999, color: "#A8916F", fontSize: 12, padding: "6px 12px", cursor: "pointer" },
  monthNav: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px 4px", position: "relative", zIndex: 1 },
  navBtn: { background: "#2A2319", border: "1px solid #3A3024", borderRadius: 8, color: "#EDE0CC", fontSize: 20, width: 36, height: 36, cursor: "pointer" },
  monthLabel: { fontSize: 17, fontWeight: 600, textTransform: "capitalize" },
  toolRow: { padding: "10px 18px 0", position: "relative", zIndex: 1 },
  toolBtn: { background: "transparent", border: "1px solid #3A3024", borderRadius: 8, color: "#A8916F", fontSize: 13, padding: "8px 12px", cursor: "pointer", width: "100%" },
  rangeBar: { display: "flex", alignItems: "center", justifyContent: "space-between", background: "#2A2319", border: "1px solid #5A4E3A", borderRadius: 8, padding: "8px 12px", gap: 8 },
  rangeBarText: { fontSize: 13, color: "#EDE0CC" },
  rangeCancelBtn: { background: "transparent", border: "none", color: "#D17555", fontSize: 12, cursor: "pointer" },
  rangeConfirmBox: { margin: "8px 18px 0", display: "flex", flexDirection: "column", position: "relative", zIndex: 1 },
  dayHeaderRow: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", padding: "14px 18px 4px", position: "relative", zIndex: 1 },
  dayHeaderCell: { textAlign: "center", fontSize: 11, color: "#8A7A60", fontFamily: "monospace", letterSpacing: 1 },
  grid: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, padding: "0 14px", position: "relative", zIndex: 1 },
  emptyCell: { aspectRatio: "1" },
  dayCell: { aspectRatio: "1", background: "#241F17", border: "1.5px solid transparent", borderRadius: 8, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, cursor: "pointer", color: "#EDE0CC", padding: 2 },
  todayCell: { borderColor: "#5A4E3A" },
  dayNum: { fontSize: 13, fontWeight: 500 },
  pillRow: { display: "flex", gap: 2, alignItems: "center", minHeight: 6 },
  pill: { width: 5, height: 5, borderRadius: "50%" },
  pillMore: { fontSize: 8, color: "#A8916F", marginLeft: 1 },
  proposalMark: { fontSize: 8, color: "#B5944B", marginLeft: 2 },
  confirmedMark: { fontSize: 8, color: "#6F8068", marginLeft: 2 },
  legend: { display: "flex", flexWrap: "wrap", gap: "8px 14px", padding: "20px 18px 0", position: "relative", zIndex: 1 },
  legendItem: { display: "flex", alignItems: "center", gap: 5, fontSize: 12 },
  upcomingBtn: { width: "100%", background: "transparent", border: "1px solid #3A3024", borderRadius: 8, color: "#A8916F", fontSize: 13, padding: "10px 14px", cursor: "pointer", textAlign: "left" },
  upcomingList: { display: "flex", flexDirection: "column", gap: 8, marginTop: 10 },
  upcomingEmpty: { fontSize: 13, color: "#8A7A60", padding: "10px 0", fontFamily: "monospace" },
  upcomingRow: { display: "flex", flexDirection: "column", borderRadius: 10, padding: "12px 14px", gap: 10 },
  upcomingProposalRow: { background: "#2A2310", border: "1.5px solid #B5944B44" },
  upcomingConfirmedRow: { background: "#1E2A1A", border: "1.5px solid #6F806844" },
  upcomingLeft: { display: "flex", alignItems: "flex-start", gap: 10 },
  upcomingDate: { fontSize: 14, fontWeight: 600, color: "#EDE0CC" },
  upcomingTime: { fontSize: 13, color: "#C2B299", fontFamily: "monospace", marginTop: 2 },
  upcomingBy: { fontSize: 11, color: "#8A7A60", marginTop: 2 },
  upcomingAbsent: { fontSize: 11, color: "#D17555", marginTop: 3 },
  calBtn: { fontSize: 10, color: "#A8916F", background: "#2A2319", border: "1px solid #3A3024", borderRadius: 6, padding: "4px 7px", textDecoration: "none", whiteSpace: "nowrap" },
  tagConfirmed: { fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "#6F8068", background: "#1A2618", border: "1px solid #6F806866", borderRadius: 6, padding: "3px 7px", flexShrink: 0 },
  tagProposal: { fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "#B5944B", background: "#251E0D", border: "1px solid #B5944B66", borderRadius: 6, padding: "3px 7px", flexShrink: 0 },
  savingToast: { position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)", background: "#2A2319", border: "1px solid #4A3F2E", borderRadius: 999, padding: "6px 14px", fontSize: 12, color: "#A8916F", zIndex: 60 },
  okToast: { position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)", background: "#26301F", border: "1px solid #6F8068", borderRadius: 999, padding: "6px 14px", fontSize: 12, color: "#B6C7A8", zIndex: 60 },
  errorToast: { position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)", background: "#2E1E18", border: "1px solid #A3523A", borderRadius: 999, padding: "6px 14px", fontSize: 12, color: "#D17555", zIndex: 60 },
  sheetOverlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "flex-end", zIndex: 50 },
  sheet: { width: "100%", maxWidth: 480, margin: "0 auto", background: "#241F17", borderRadius: "18px 18px 0 0", padding: "10px 22px 26px", display: "flex", flexDirection: "column", gap: 10, maxHeight: "85vh", overflowY: "auto" },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, background: "#4A3F2E", alignSelf: "center", marginBottom: 6 },
  sheetDate: { fontSize: 17, fontWeight: 600 },
  sheetDivider: { borderTop: "1px solid #3A3024", margin: "4px 0" },
  unavailableBox: { background: "#2A1A1A", border: "1px solid #5A2A2A", borderRadius: 10, padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8 },
  unavailableLabel: { fontSize: 12, fontWeight: 700, color: "#D17555", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 2 },
  whoRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 14 },
  whoName: { fontWeight: 600 },
  whoNote: { color: "#A8916F", fontSize: 13 },
  sheetActionLabel: { fontSize: 13, color: "#A8916F", marginTop: 2 },
  noteInput: { background: "#1C1812", border: "1px solid #4A3F2E", borderRadius: 8, color: "#EDE0CC", padding: "10px 12px", fontSize: 14 },
  sheetButtons: { display: "flex", gap: 10, marginTop: 4 },
  sheetMainBtn: { flex: 1, border: "none", borderRadius: 10, color: "#1C1812", fontWeight: 700, fontSize: 15, padding: "13px 0", cursor: "pointer" },
  sheetCancelBtn: { flex: 1, background: "transparent", border: "1px solid #4A3F2E", borderRadius: 10, color: "#A8916F", fontWeight: 600, fontSize: 15, padding: "13px 0", cursor: "pointer" },
  proposalList: { display: "flex", flexDirection: "column", gap: 8 },
  proposalRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, background: "#1C1812", border: "1px solid #3A3024", borderRadius: 10, padding: "10px 12px" },
  proposalInfo: { display: "flex", flexDirection: "column", gap: 2 },
  proposalTime: { fontSize: 15, fontWeight: 700, fontFamily: "monospace" },
  proposalLabel: { fontSize: 12, color: "#C2B299" },
  proposalBy: { fontSize: 10, color: "#8A7A60", fontFamily: "monospace" },
  proposalConfirmedTag: { fontSize: 10, color: "#6F8068", fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase" },
  proposalActions: { display: "flex", alignItems: "center", gap: 6, flexShrink: 0 },
  proposalConfirmBtn: { border: "none", borderRadius: 8, fontSize: 11, fontWeight: 600, padding: "8px 10px", cursor: "pointer", whiteSpace: "nowrap" },
  proposalDeleteBtn: { background: "transparent", border: "none", color: "#6A5A45", fontSize: 14, cursor: "pointer", padding: "4px 6px" },
  proposalForm: { display: "flex", gap: 8, marginTop: 4 },
  setlistList: { display: "flex", flexDirection: "column", gap: 6 },
  setlistRow: { background: "#1C1812", border: "1px solid #3A3024", borderRadius: 10, padding: "12px 14px", userSelect: "none" },
  setlistTop: { display: "flex", alignItems: "center", gap: 10 },
  setlistNum: { fontSize: 18, fontWeight: 900, color: "#4A3F2E", fontFamily: "monospace", width: 22, textAlign: "right", flexShrink: 0 },
  setlistTitle: { fontSize: 14, fontWeight: 600, color: "#EDE0CC" },
  setlistArtist: { fontSize: 12, color: "#8A7A60", marginTop: 2 },
  docsToggleBtn: { fontSize: 11, color: "#A8916F", background: "#2A2319", border: "1px solid #3A3024", borderRadius: 6, padding: "5px 10px", cursor: "pointer", flexShrink: 0 },
  dragHandle: { fontSize: 16, color: "#4A3F2E", cursor: "grab", flexShrink: 0 },
  docsPanel: { marginTop: 12, paddingTop: 12, borderTop: "1px solid #3A3024", display: "flex", flexDirection: "column", gap: 8 },
  docList: { display: "flex", flexDirection: "column", gap: 6 },
  docRow: { display: "flex", alignItems: "center", gap: 8, background: "#241F17", borderRadius: 8, padding: "8px 10px" },
  docIcon: { fontSize: 16, flexShrink: 0 },
  docLink: { flex: 1, fontSize: 13, color: "#B5944B", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  docDeleteBtn: { background: "transparent", border: "none", color: "#6A5A45", fontSize: 14, cursor: "pointer", padding: "2px 4px", flexShrink: 0 },
  uploadArea: { display: "flex", alignItems: "center", justifyContent: "center", background: "#1C1812", border: "1px dashed #4A3F2E", borderRadius: 8, padding: "12px", fontSize: 13, color: "#8A7A60", cursor: "pointer" },
  linkRow: { display: "flex", alignItems: "center", gap: 8 },
  linkIcon: { fontSize: 14, flexShrink: 0, width: 20, textAlign: "center" },
  linkInput: { flex: 1, background: "#1C1812", border: "1px solid #3A3024", borderRadius: 8, color: "#EDE0CC", padding: "8px 10px", fontSize: 13 },
  linkOpenBtn: { background: "#251E0D", border: "1px solid #B5944B44", borderRadius: 6, color: "#B5944B", fontSize: 13, padding: "6px 10px", textDecoration: "none", flexShrink: 0 },
  proposalSectionHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "2px solid #3A3024", paddingTop: 12, marginTop: 4 },
  proposalSectionTitle: { fontSize: 14, fontWeight: 700, color: "#B5944B" },
  proposeBtn: { fontSize: 12, background: "transparent", border: "1px solid #B5944B66", borderRadius: 8, color: "#B5944B", padding: "6px 12px", cursor: "pointer" },
  proposeForm: { display: "flex", flexDirection: "column", gap: 8, background: "#1C1812", border: "1px solid #B5944B44", borderRadius: 10, padding: "14px" },
  songProposalRow: { background: "#1C1510", border: "1.5px dashed #B5944B66", borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 },
  proposalBadge: { fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "#B5944B", background: "#251E0D", border: "1px solid #B5944B44", borderRadius: 4, padding: "2px 6px", flexShrink: 0 },
  proposalMotivation: { fontSize: 12, color: "#A8916F", fontStyle: "italic", marginTop: 3 },
  songProposalActions: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  approveBtn: { fontSize: 12, background: "#26301F", border: "1px solid #6F806866", borderRadius: 8, color: "#6F8068", padding: "6px 12px", cursor: "pointer", fontWeight: 600 },
};
