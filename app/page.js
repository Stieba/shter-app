"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../lib/supabaseClient";

const MONTH_NAMES = [
  "januari", "februari", "maart", "april", "mei", "juni",
  "juli", "augustus", "september", "oktober", "november", "december"
];
const DAY_NAMES = ["ma", "di", "wo", "do", "vr", "za", "zo"];

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
  return `${parseInt(d, 10)} ${MONTH_NAMES[parseInt(m, 10) - 1]}`;
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

export default function ShterKalender() {
  const [members, setMembers] = useState([]);
  const [currentMember, setCurrentMember] = useState(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth());
  const [blocks, setBlocks] = useState({});
  const [proposals, setProposals] = useState({});
  const [songs, setSongs] = useState([]);
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
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef(null);
  const bannerTimer = useRef(null);

  function flashBanner(text, tone = "ok") {
    setBanner({ text, tone });
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    bannerTimer.current = setTimeout(() => setBanner(null), 2600);
  }

  const loadAll = useCallback(async () => {
    const [
      { data: memberRows, error: mErr },
      { data: blockRows, error: bErr },
      { data: propRows, error: pErr },
      { data: songRows, error: sErr },
    ] = await Promise.all([
      supabase.from("members").select("*").order("sort_order"),
      supabase.from("blocks").select("*"),
      supabase.from("proposals").select("*"),
      supabase.from("songs").select("*").order("sort_order"),
    ]);

    if (mErr || bErr || pErr || sErr) {
      flashBanner("Kon gegevens niet laden — controleer internetverbinding", "err");
      return;
    }

    setMembers(memberRows || []);
    setSongs(songRows || []);

    const blockMap = {};
    for (const row of blockRows || []) {
      if (!blockMap[row.date]) blockMap[row.date] = {};
      blockMap[row.date][row.member_name] = row.note || "";
    }
    setBlocks(blockMap);

    const propMap = {};
    for (const row of propRows || []) {
      if (!propMap[row.date]) propMap[row.date] = [];
      propMap[row.date].push({
        id: row.id, time: row.time, label: row.label || "",
        by: row.proposed_by, confirmed: row.confirmed,
      });
    }
    setProposals(propMap);
  }, []);

  useEffect(() => {
    (async () => { await loadAll(); setLoading(false); })();
    const channel = supabase
      .channel("shter-kalender-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "blocks" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "proposals" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "members" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "songs" }, loadAll)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadAll]);

  async function uploadAvatar(file) {
    if (!currentMember && !uploadingAvatar) return;
    const memberName = currentMember || uploadingAvatar;
    setUploadingAvatar(memberName);
    const ext = file.name.split(".").pop();
    const path = `${memberName}.${ext}`;
    const { error: upErr } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
    if (upErr) { flashBanner("Foto uploaden mislukt", "err"); setUploadingAvatar(false); return; }
    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    await supabase.from("members").update({ avatar_url: data.publicUrl + "?t=" + Date.now() }).eq("name", memberName);
    setUploadingAvatar(false);
    flashBanner("Profielfoto opgeslagen!", "ok");
    await loadAll();
  }

  async function uploadDocument(songId, file) {
    setSaving(true);
    const path = `song-${songId}.pdf`;
    const { error: upErr } = await supabase.storage.from("documents").upload(path, file, { upsert: true });
    if (upErr) { flashBanner("PDF uploaden mislukt", "err"); setSaving(false); return; }
    const { data } = supabase.storage.from("documents").getPublicUrl(path);
    await supabase.from("songs").update({ document_url: data.publicUrl }).eq("id", songId);
    setSaving(false);
    flashBanner("PDF opgeslagen!", "ok");
    await loadAll();
  }

  async function reorderSongs(newOrder) {
    setSongs(newOrder);
    const updates = newOrder.map((s, i) => supabase.from("songs").update({ sort_order: i }).eq("id", s.id));
    await Promise.all(updates);
  }

  async function toggleBlock(key, note) {
    if (!currentMember) return;
    setSaving(true);
    const alreadyBlocked = blocks[key]?.[currentMember] !== undefined;
    if (alreadyBlocked) {
      const { error } = await supabase.from("blocks").delete().eq("date", key).eq("member_name", currentMember);
      if (error) flashBanner("Deblokkeren mislukt, probeer opnieuw", "err");
    } else {
      const { error } = await supabase.from("blocks").upsert({ date: key, member_name: currentMember, note: note || "" }, { onConflict: "date,member_name" });
      if (error) flashBanner("Blokkeren mislukt, probeer opnieuw", "err");
    }
    setSaving(false);
    await loadAll();
  }

  async function blockRange(startKey, endKey, note) {
    if (!currentMember) return;
    setSaving(true);
    const days = keysInRange(startKey, endKey);
    const rows = days.map((d) => ({ date: d, member_name: currentMember, note: note || "" }));
    const { error } = await supabase.from("blocks").upsert(rows, { onConflict: "date,member_name" });
    setSaving(false);
    if (error) { flashBanner("Blokkeren mislukt, probeer opnieuw", "err"); }
    else { flashBanner(`${days.length} dag${days.length === 1 ? "" : "en"} geblokkeerd`, "ok"); }
    await loadAll();
  }

  async function addProposal() {
    if (!selectedDay || !currentMember || !proposalTimeDraft) return;
    setSaving(true);
    const { error } = await supabase.from("proposals").insert({
      date: selectedDay, time: proposalTimeDraft,
      label: proposalLabelDraft.trim(), proposed_by: currentMember, confirmed: false,
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
    const { error } = await supabase.from("proposals").delete().eq("id", id);
    setSaving(false);
    if (error) flashBanner("Verwijderen mislukt", "err");
    await loadAll();
  }

  async function addMember() {
    const name = newMemberDraft.trim();
    if (!name || members.some((m) => m.name === name)) return;
    if (members.length >= 10) return;
    const palette = ["#C9744A", "#8A6A4F", "#B5944B", "#6F8068", "#A35238", "#7A6A8A", "#C2A05E", "#5E7A78", "#9C5B4A", "#80724F"];
    const color = palette[members.length % palette.length];
    const { error } = await supabase.from("members").insert({ name, color, sort_order: members.length });
    if (error) { flashBanner("Bandlid toevoegen mislukt (naam al in gebruik?)", "err"); return; }
    setNewMemberDraft("");
    setShowAddMember(false);
    await loadAll();
  }

  function openDay(key) {
    if (rangeMode) {
      if (!rangeStart || (rangeStart && rangeEnd)) { setRangeStart(key); setRangeEnd(null); }
      else { setRangeEnd(key); }
      return;
    }
    setSelectedDay(key);
    setNoteDraft(blocks[key]?.[currentMember] || "");
    setProposalTimeDraft("20:00");
    setProposalLabelDraft("");
  }
  function closeDay() { setSelectedDay(null); setNoteDraft(""); }
  function confirmDayAction() { if (!selectedDay) return; toggleBlock(selectedDay, noteDraft); closeDay(); }
  function confirmRange() {
    if (!rangeStart || !rangeEnd) return;
    blockRange(rangeStart, rangeEnd, rangeNote);
    setRangeStart(null); setRangeEnd(null); setRangeNote(""); setRangeMode(false);
  }
  function cancelRange() { setRangeStart(null); setRangeEnd(null); setRangeNote(""); setRangeMode(false); }
  function prevMonth() { if (month === 0) { setMonth(11); setYear((y) => y - 1); } else setMonth((m) => m - 1); }
  function nextMonth() { if (month === 11) { setMonth(0); setYear((y) => y + 1); } else setMonth((m) => m + 1); }

  // drag & drop setlist
  function onDragStart(idx) { setDragIdx(idx); }
  function onDragOver(e, idx) {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    const newSongs = [...songs];
    const [moved] = newSongs.splice(dragIdx, 1);
    newSongs.splice(idx, 0, moved);
    setDragIdx(idx);
    setSongs(newSongs);
  }
  function onDragEnd() { reorderSongs(songs); setDragIdx(null); }

  if (loading) {
    return (
      <div style={styles.loadingScreen}>
        <div style={styles.loadingMark}>S</div>
        <div style={{ color: "#A8916F", fontFamily: "monospace", fontSize: 13 }}>kalender laden…</div>
      </div>
    );
  }

  const colorFor = (name) => members.find((m) => m.name === name)?.color || "#8A7A60";
  const avatarFor = (name) => members.find((m) => m.name === name)?.avatar_url || null;

  if (!currentMember) {
    return (
      <div style={styles.app}>
        <div style={styles.bgPoster} />
        <div style={styles.identityScreen}>
          <div style={styles.logo}>SHTER</div>
          <div style={styles.logoSub}>★ jongûh! tour ★ bandplanning</div>
          <div style={styles.identityPrompt}>wie ben jij?</div>
          <div style={styles.memberGrid}>
            {members.map((m) => (
              <div key={m.id} style={styles.memberPickRow}>
                <button
                  onClick={() => setCurrentMember(m.name)}
                  style={{ ...styles.memberPick, borderColor: m.color, flex: 1 }}
                >
                  {m.avatar_url ? (
                    <img src={m.avatar_url} alt={m.name} style={styles.avatarSmall} />
                  ) : (
                    <span style={{ ...styles.avatarPlaceholder, background: m.color + "44", color: m.color }}>
                      {m.name[0].toUpperCase()}
                    </span>
                  )}
                  {m.name}
                </button>
                <label style={styles.avatarUploadBtn} title="foto uploaden">
                  📷
                  <input
                    type="file" accept="image/*" style={{ display: "none" }}
                    onChange={(e) => { if (e.target.files[0]) { setCurrentMember(m.name); uploadAvatar(e.target.files[0]); } }}
                  />
                </label>
              </div>
            ))}
          </div>
          {members.length < 10 && (
            <button style={styles.ghostBtn} onClick={() => setShowAddMember(true)}>+ lid toevoegen</button>
          )}
          {showAddMember && (
            <div style={styles.inlineAdd}>
              <input autoFocus value={newMemberDraft} onChange={(e) => setNewMemberDraft(e.target.value)}
                placeholder="naam" style={styles.input}
                onKeyDown={(e) => { if (e.key === "Enter") addMember(); }} />
              <button style={styles.smallBtn} onClick={addMember}>toevoegen</button>
            </div>
          )}
          {banner && (
            <div style={{ ...(banner.tone === "err" ? styles.errorToastStatic : styles.okToastStatic), marginTop: 16 }}>
              {banner.text}
            </div>
          )}
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
    <div style={styles.app}>
      <div style={styles.bgPoster} />

      <header style={styles.header}>
        <div>
          <div style={styles.logoSmall}>SHTER</div>
          <div style={styles.headerSub}>bandplanning</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button style={styles.setlistHeaderBtn} onClick={() => setShowSetlist(true)}>♪ setlist</button>
          <button
            style={{ ...styles.youBadge, borderColor: myColor }}
            onClick={() => setCurrentMember(null)}
            title="wisselen van lid"
          >
            {myAvatar ? (
              <img src={myAvatar} alt={currentMember} style={styles.avatarBadge} />
            ) : (
              <span style={{ ...styles.dot, background: myColor }} />
            )}
            {currentMember}
          </button>
        </div>
      </header>

      <div style={styles.monthNav}>
        <button style={styles.navBtn} onClick={prevMonth} aria-label="vorige maand">‹</button>
        <div style={styles.monthLabel}>{MONTH_NAMES[month]} {year}</div>
        <button style={styles.navBtn} onClick={nextMonth} aria-label="volgende maand">›</button>
      </div>

      <div style={styles.toolRow}>
        {!rangeMode ? (
          <button style={styles.toolBtn} onClick={() => setRangeMode(true)}>van — tot blokkeren</button>
        ) : (
          <div style={styles.rangeBar}>
            <span style={styles.rangeBarText}>
              {!rangeStart && "kies startdag"}
              {rangeStart && !rangeEnd && `start: ${formatNice(rangeStart)} — kies einddag`}
              {rangeStart && rangeEnd && `${formatNice(rangeStart)} → ${formatNice(rangeEnd)}`}
            </span>
            <button style={styles.rangeCancelBtn} onClick={cancelRange}>annuleren</button>
          </div>
        )}
      </div>

      {rangeMode && rangeStart && rangeEnd && (
        <div style={styles.rangeConfirmBox}>
          <input value={rangeNote} onChange={(e) => setRangeNote(e.target.value)}
            placeholder="notitie (optioneel)" style={styles.noteInput} />
          <button style={{ ...styles.sheetMainBtn, background: myColor, marginTop: 8 }} onClick={confirmRange}>
            {keysInRange(rangeStart, rangeEnd).length} dagen blokkeren
          </button>
        </div>
      )}

      <div style={styles.dayHeaderRow}>
        {DAY_NAMES.map((d) => <div key={d} style={styles.dayHeaderCell}>{d}</div>)}
      </div>

      <div style={styles.grid}>
        {grid.map((d, idx) => {
          if (d === null) return <div key={`empty-${idx}`} style={styles.emptyCell} />;
          const key = dateKey(year, month, d);
          const dayBlocks = blocks[key] || {};
          const blockedNames = Object.keys(dayBlocks);
          const iAmBlocked = blockedNames.includes(currentMember);
          const isToday = key === tKey;
          const dayProposals = proposals[key] || [];
          const inRangeSelection = (rangeStart === key && !rangeEnd) || (rangeSet && rangeSet.has(key));
          const hasConfirmed = dayProposals.some((p) => p.confirmed);
          const hasProposal = dayProposals.length > 0 && !hasConfirmed;

          return (
            <button key={key} onClick={() => openDay(key)}
              style={{
                ...styles.dayCell,
                ...(isToday ? styles.todayCell : {}),
                ...(hasProposal ? { borderColor: "#B5944B", borderWidth: 2 } : {}),
                ...(hasConfirmed ? { borderColor: "#6F8068", borderWidth: 2, background: "#1E2A1A" } : {}),
                ...(iAmBlocked ? { background: hasConfirmed ? "#1E2A1A" : myColor + "22", borderColor: iAmBlocked && !hasConfirmed && !hasProposal ? myColor : undefined } : {}),
                ...(inRangeSelection ? { background: myColor + "55", borderColor: myColor, borderWidth: 2 } : {}),
              }}
            >
              <span style={styles.dayNum}>{d}</span>
              <div style={styles.pillRow}>
                {blockedNames.slice(0, 4).map((name) => (
                  <span key={name} style={{ ...styles.pill, background: colorFor(name) }} />
                ))}
                {blockedNames.length > 4 && <span style={styles.pillMore}>+{blockedNames.length - 4}</span>}
                {hasConfirmed && <span style={styles.confirmedMark} title="definitieve repetitie">●</span>}
                {hasProposal && <span style={styles.proposalMark} title="voorstel repetitie">◎</span>}
              </div>
            </button>
          );
        })}
      </div>

      <div style={styles.legend}>
        {members.map((m) => (
          <div key={m.id} style={styles.legendItem}>
            <span style={{ ...styles.dot, background: m.color }} />
            <span style={{ opacity: m.name === currentMember ? 1 : 0.6 }}>{m.name}</span>
          </div>
        ))}
        <div style={styles.legendItem}>
          <span style={{ ...styles.proposalMark, fontSize: 10 }}>◎</span>
          <span style={{ opacity: 0.6, fontSize: 12 }}>voorstel</span>
        </div>
        <div style={styles.legendItem}>
          <span style={{ ...styles.confirmedMark, fontSize: 10 }}>●</span>
          <span style={{ opacity: 0.6, fontSize: 12 }}>definitief</span>
        </div>
      </div>

      <div style={{ padding: "12px 18px 0" }}>
        <button style={styles.upcomingBtn} onClick={() => setShowUpcoming((v) => !v)}>
          {showUpcoming ? "▲" : "▼"} aankomende repetities
        </button>
        {showUpcoming && (() => {
          const tk = todayKey();
          const upcoming = Object.entries(proposals)
            .filter(([date]) => date >= tk)
            .sort(([a], [b]) => a.localeCompare(b))
            .flatMap(([date, props]) => props.map((p) => ({ date, ...p })));
          if (upcoming.length === 0) {
            return <div style={styles.upcomingEmpty}>geen aankomende repetities gepland</div>;
          }
          return (
            <div style={styles.upcomingList}>
              {upcoming.map((p) => {
                const [y, m, d] = p.date.split("-");
                const dateStr = `${parseInt(d, 10)} ${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}`;
                return (
                  <div key={p.id} style={{ ...styles.upcomingRow, ...(p.confirmed ? styles.upcomingConfirmedRow : styles.upcomingProposalRow) }}>
                    <div style={styles.upcomingLeft}>
                      <span style={p.confirmed ? styles.confirmedMark : styles.proposalMark}>
                        {p.confirmed ? "●" : "◎"}
                      </span>
                      <div>
                        <div style={styles.upcomingDate}>{dateStr}</div>
                        <div style={styles.upcomingTime}>{p.time}{p.label ? ` — ${p.label}` : ""}</div>
                        <div style={styles.upcomingBy}>voorgesteld door {p.by}</div>
                      </div>
                    </div>
                    <span style={p.confirmed ? styles.upcomingTagConfirmed : styles.upcomingTagProposal}>
                      {p.confirmed ? "definitief" : "voorstel"}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>

      {saving && <div style={styles.savingToast}>opslaan…</div>}
      {banner && <div style={banner.tone === "err" ? styles.errorToast : styles.okToast}>{banner.text}</div>}

      {/* Dag detail sheet */}
      {selectedDay && (
        <div style={styles.sheetOverlay} onClick={closeDay}>
          <div style={styles.sheet} onClick={(e) => e.stopPropagation()}>
            <div style={styles.sheetHandle} />
            <div style={styles.sheetDate}>
              {(() => { const [, m, d] = selectedDay.split("-"); return `${parseInt(d, 10)} ${MONTH_NAMES[parseInt(m, 10) - 1]} ${year}`; })()}
            </div>
            {Object.keys(blocks[selectedDay] || {}).length > 0 && (
              <div style={styles.whoList}>
                {Object.entries(blocks[selectedDay] || {}).map(([name, note]) => (
                  <div key={name} style={styles.whoRow}>
                    {avatarFor(name) ? (
                      <img src={avatarFor(name)} alt={name} style={styles.avatarSmall} />
                    ) : (
                      <span style={{ ...styles.dot, background: colorFor(name) }} />
                    )}
                    <span style={styles.whoName}>{name}</span>
                    {note ? <span style={styles.whoNote}>— {note}</span> : null}
                  </div>
                ))}
              </div>
            )}
            <div style={styles.sheetActionLabel}>
              {blocks[selectedDay]?.[currentMember] !== undefined ? "Jij hebt deze dag geblokkeerd" : "Markeer deze dag als niet beschikbaar"}
            </div>
            {blocks[selectedDay]?.[currentMember] === undefined && (
              <input value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="notitie (optioneel)" style={styles.noteInput} />
            )}
            <div style={styles.sheetButtons}>
              <button
                style={{ ...styles.sheetMainBtn, background: blocks[selectedDay]?.[currentMember] !== undefined ? "#3A3024" : myColor }}
                onClick={confirmDayAction}
              >
                {blocks[selectedDay]?.[currentMember] !== undefined ? "Deblokkeren" : "Blokkeren"}
              </button>
              <button style={styles.sheetCancelBtn} onClick={closeDay}>Sluiten</button>
            </div>
            <div style={styles.sheetDivider} />
            <div style={styles.sheetActionLabel}>Repetitietijd voorstellen</div>
            {(proposals[selectedDay] || []).length > 0 && (
              <div style={styles.proposalList}>
                {(proposals[selectedDay] || []).slice().sort((a, b) => a.time.localeCompare(b.time)).map((p) => (
                  <div key={p.id} style={{ ...styles.proposalRow, ...(p.confirmed ? { borderColor: "#6F8068", background: "#1E2A1A" } : {}) }}>
                    <div style={styles.proposalInfo}>
                      <span style={styles.proposalTime}>{p.time}</span>
                      {p.label && <span style={styles.proposalLabel}>{p.label}</span>}
                      <span style={styles.proposalBy}>voorgesteld door {p.by}</span>
                      {p.confirmed && <span style={styles.proposalConfirmedTag}>definitief</span>}
                    </div>
                    <div style={styles.proposalActions}>
                      <button
                        style={{ ...styles.proposalConfirmBtn, ...(p.confirmed ? { background: "#3A3024", color: "#EDE0CC" } : { background: myColor, color: "#1C1812" }) }}
                        onClick={() => toggleConfirmProposal(p.id, p.confirmed)}
                      >
                        {p.confirmed ? "annuleer" : "maak definitief"}
                      </button>
                      <button style={styles.proposalDeleteBtn} onClick={() => removeProposal(p.id)}>✕</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div style={styles.proposalForm}>
              <input type="time" value={proposalTimeDraft} onChange={(e) => setProposalTimeDraft(e.target.value)}
                style={{ ...styles.noteInput, flex: "0 0 110px" }} />
              <input value={proposalLabelDraft} onChange={(e) => setProposalLabelDraft(e.target.value)}
                placeholder="bv. studio, bij Bram" style={{ ...styles.noteInput, flex: 1 }} />
            </div>
            <button style={{ ...styles.ghostBtn, marginTop: 0, maxWidth: "none" }} onClick={addProposal}>
              + voorstel toevoegen
            </button>
          </div>
        </div>
      )}

      {/* Setlist overlay */}
      {showSetlist && (
        <div style={styles.sheetOverlay} onClick={() => setShowSetlist(false)}>
          <div style={{ ...styles.sheet, maxHeight: "90vh" }} onClick={(e) => e.stopPropagation()}>
            <div style={styles.sheetHandle} />
            <div style={styles.sheetDate}>♪ Setlist</div>
            <div style={{ fontSize: 12, color: "#8A7A60", fontFamily: "monospace" }}>sleep om volgorde aan te passen</div>
            <div style={styles.setlistList}>
              {songs.map((song, idx) => (
                <div
                  key={song.id}
                  draggable
                  onDragStart={() => onDragStart(idx)}
                  onDragOver={(e) => onDragOver(e, idx)}
                  onDragEnd={onDragEnd}
                  style={{ ...styles.setlistRow, ...(dragIdx === idx ? { opacity: 0.5 } : {}) }}
                >
                  <div style={styles.setlistLeft}>
                    <span style={styles.setlistNum}>{idx + 1}</span>
                    <div>
                      <div style={styles.setlistTitle}>{song.title}</div>
                      <div style={styles.setlistArtist}>{song.artist}</div>
                    </div>
                  </div>
                  <div style={styles.setlistRight}>
                    {song.document_url ? (
                      <a href={song.document_url} target="_blank" rel="noreferrer" style={styles.pdfLink}>📄 PDF</a>
                    ) : null}
                    <label style={styles.pdfUploadBtn} title="PDF uploaden">
                      {song.document_url ? "↑" : "+ PDF"}
                      <input type="file" accept="application/pdf" style={{ display: "none" }}
                        onChange={(e) => { if (e.target.files[0]) uploadDocument(song.id, e.target.files[0]); }} />
                    </label>
                    <span style={styles.dragHandle}>⠿</span>
                  </div>
                </div>
              ))}
            </div>
            <button style={styles.sheetCancelBtn} onClick={() => setShowSetlist(false)}>Sluiten</button>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  app: { minHeight: "100vh", background: "#1C1812", color: "#EDE0CC", fontFamily: "'Helvetica Neue', Arial, sans-serif", maxWidth: 480, margin: "0 auto", paddingBottom: 32, position: "relative" },
  bgPoster: { position: "fixed", inset: 0, backgroundImage: "url('/shter-poster.jpg')", backgroundSize: "cover", backgroundPosition: "center top", opacity: 0.07, zIndex: 0, pointerEvents: "none", maxWidth: 480, margin: "0 auto" },
  loadingScreen: { minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, background: "#1C1812" },
  loadingMark: { fontFamily: "'Arial Black', Impact, sans-serif", fontWeight: 900, fontSize: 48, color: "#C9744A" },
  identityScreen: { minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 20px", gap: 6, position: "relative", zIndex: 1 },
  logo: { fontFamily: "'Arial Black', Impact, sans-serif", fontWeight: 900, fontSize: 52, letterSpacing: 1, color: "#EDE0CC", textTransform: "uppercase", textShadow: "2px 2px 0 #3A2A1E" },
  logoSub: { fontFamily: "monospace", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "#A8916F", marginBottom: 36, textAlign: "center" },
  identityPrompt: { fontFamily: "monospace", fontSize: 13, letterSpacing: 2, textTransform: "uppercase", color: "#8A7A60", marginBottom: 18 },
  memberGrid: { display: "flex", flexDirection: "column", gap: 10, width: "100%", maxWidth: 320 },
  memberPickRow: { display: "flex", alignItems: "center", gap: 6 },
  memberPick: { display: "flex", alignItems: "center", gap: 10, background: "#2A2319", border: "1.5px solid", borderRadius: 10, color: "#EDE0CC", fontSize: 16, padding: "12px 16px", cursor: "pointer", textAlign: "left" },
  avatarSmall: { width: 28, height: 28, borderRadius: "50%", objectFit: "cover", flexShrink: 0 },
  avatarPlaceholder: { width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, flexShrink: 0 },
  avatarBadge: { width: 20, height: 20, borderRadius: "50%", objectFit: "cover", flexShrink: 0 },
  avatarUploadBtn: { background: "#2A2319", border: "1px solid #4A3F2E", borderRadius: 8, padding: "10px 12px", cursor: "pointer", fontSize: 16, flexShrink: 0 },
  dot: { width: 10, height: 10, borderRadius: "50%", flexShrink: 0 },
  ghostBtn: { marginTop: 20, background: "transparent", border: "1px dashed #5A4E3A", borderRadius: 10, color: "#A8916F", fontSize: 14, padding: "10px 16px", cursor: "pointer", width: "100%", maxWidth: 320 },
  inlineAdd: { display: "flex", gap: 8, marginTop: 12, width: "100%", maxWidth: 320 },
  input: { flex: 1, background: "#2A2319", border: "1px solid #4A3F2E", borderRadius: 8, color: "#EDE0CC", padding: "10px 12px", fontSize: 14 },
  smallBtn: { background: "#C9744A", border: "none", borderRadius: 8, color: "#1C1812", fontWeight: 600, padding: "10px 14px", fontSize: 13, cursor: "pointer" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 18px 8px", position: "relative", zIndex: 1 },
  logoSmall: { fontFamily: "'Arial Black', Impact, sans-serif", fontWeight: 900, fontSize: 24, letterSpacing: 0.5, color: "#EDE0CC", textTransform: "uppercase" },
  headerSub: { fontFamily: "monospace", fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: "#8A7A60" },
  youBadge: { display: "flex", alignItems: "center", gap: 6, background: "#2A2319", border: "1.5px solid", borderRadius: 999, color: "#EDE0CC", fontSize: 13, padding: "6px 12px", cursor: "pointer" },
  setlistHeaderBtn: { background: "transparent", border: "1px solid #3A3024", borderRadius: 999, color: "#A8916F", fontSize: 12, padding: "6px 12px", cursor: "pointer" },
  monthNav: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px 4px", position: "relative", zIndex: 1 },
  navBtn: { background: "#2A2319", border: "1px solid #3A3024", borderRadius: 8, color: "#EDE0CC", fontSize: 20, width: 36, height: 36, cursor: "pointer", lineHeight: 1 },
  monthLabel: { fontSize: 17, fontWeight: 600, textTransform: "capitalize" },
  toolRow: { padding: "10px 18px 0", position: "relative", zIndex: 1 },
  toolBtn: { background: "transparent", border: "1px solid #3A3024", borderRadius: 8, color: "#A8916F", fontSize: 13, padding: "8px 12px", cursor: "pointer", width: "100%" },
  rangeBar: { display: "flex", alignItems: "center", justifyContent: "space-between", background: "#2A2319", border: "1px solid #5A4E3A", borderRadius: 8, padding: "8px 12px", gap: 8 },
  rangeBarText: { fontSize: 13, color: "#EDE0CC" },
  rangeCancelBtn: { background: "transparent", border: "none", color: "#D17555", fontSize: 12, cursor: "pointer", flexShrink: 0 },
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
  legendItem: { display: "flex", alignItems: "center", gap: 6, fontSize: 12 },
  upcomingBtn: { width: "100%", background: "transparent", border: "1px solid #3A3024", borderRadius: 8, color: "#A8916F", fontSize: 13, padding: "10px 14px", cursor: "pointer", textAlign: "left" },
  upcomingList: { display: "flex", flexDirection: "column", gap: 8, marginTop: 10 },
  upcomingEmpty: { fontSize: 13, color: "#8A7A60", padding: "12px 0", fontFamily: "monospace" },
  upcomingRow: { display: "flex", alignItems: "center", justifyContent: "space-between", borderRadius: 10, padding: "12px 14px", gap: 10 },
  upcomingProposalRow: { background: "#2A2310", border: "1.5px solid #B5944B44" },
  upcomingConfirmedRow: { background: "#1E2A1A", border: "1.5px solid #6F806844" },
  upcomingLeft: { display: "flex", alignItems: "flex-start", gap: 10 },
  upcomingDate: { fontSize: 14, fontWeight: 600, color: "#EDE0CC" },
  upcomingTime: { fontSize: 13, color: "#C2B299", fontFamily: "monospace", marginTop: 2 },
  upcomingBy: { fontSize: 11, color: "#8A7A60", marginTop: 2 },
  upcomingTagConfirmed: { fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "#6F8068", background: "#1A2618", border: "1px solid #6F806866", borderRadius: 6, padding: "3px 7px", flexShrink: 0 },
  upcomingTagProposal: { fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "#B5944B", background: "#251E0D", border: "1px solid #B5944B66", borderRadius: 6, padding: "3px 7px", flexShrink: 0 },
  savingToast: { position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)", background: "#2A2319", border: "1px solid #4A3F2E", borderRadius: 999, padding: "6px 14px", fontSize: 12, color: "#A8916F", zIndex: 60 },
  okToast: { position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)", background: "#26301F", border: "1px solid #6F8068", borderRadius: 999, padding: "6px 14px", fontSize: 12, color: "#B6C7A8", zIndex: 60 },
  errorToast: { position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)", background: "#2E1E18", border: "1px solid #A3523A", borderRadius: 999, padding: "6px 14px", fontSize: 12, color: "#D17555", zIndex: 60 },
  okToastStatic: { background: "#26301F", border: "1px solid #6F8068", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#B6C7A8" },
  errorToastStatic: { background: "#2E1E18", border: "1px solid #A3523A", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#D17555" },
  sheetOverlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "flex-end", zIndex: 50 },
  sheet: { width: "100%", maxWidth: 480, margin: "0 auto", background: "#241F17", borderRadius: "18px 18px 0 0", padding: "10px 22px 26px", display: "flex", flexDirection: "column", gap: 10, maxHeight: "85vh", overflowY: "auto" },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, background: "#4A3F2E", alignSelf: "center", marginBottom: 6 },
  sheetDate: { fontSize: 17, fontWeight: 600, textTransform: "capitalize" },
  sheetDivider: { borderTop: "1px solid #3A3024", margin: "6px 0 0" },
  whoList: { display: "flex", flexDirection: "column", gap: 8, padding: "8px 0", borderTop: "1px solid #3A3024", borderBottom: "1px solid #3A3024" },
  whoRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 14 },
  whoName: { fontWeight: 500 },
  whoNote: { color: "#A8916F", fontSize: 13 },
  sheetActionLabel: { fontSize: 13, color: "#A8916F", marginTop: 4 },
  noteInput: { background: "#1C1812", border: "1px solid #4A3F2E", borderRadius: 8, color: "#EDE0CC", padding: "10px 12px", fontSize: 14 },
  sheetButtons: { display: "flex", gap: 10, marginTop: 8 },
  sheetMainBtn: { flex: 1, border: "none", borderRadius: 10, color: "#1C1812", fontWeight: 700, fontSize: 15, padding: "13px 0", cursor: "pointer" },
  sheetCancelBtn: { flex: 1, background: "transparent", border: "1px solid #4A3F2E", borderRadius: 10, color: "#A8916F", fontWeight: 600, fontSize: 15, padding: "13px 0", cursor: "pointer" },
  proposalList: { display: "flex", flexDirection: "column", gap: 8 },
  proposalRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, background: "#1C1812", border: "1px solid #3A3024", borderRadius: 10, padding: "10px 12px" },
  proposalInfo: { display: "flex", flexDirection: "column", gap: 1 },
  proposalTime: { fontSize: 15, fontWeight: 700, fontFamily: "monospace" },
  proposalLabel: { fontSize: 12, color: "#C2B299" },
  proposalBy: { fontSize: 10, color: "#8A7A60", fontFamily: "monospace" },
  proposalConfirmedTag: { fontSize: 10, color: "#6F8068", fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase" },
  proposalActions: { display: "flex", alignItems: "center", gap: 6, flexShrink: 0 },
  proposalConfirmBtn: { border: "none", borderRadius: 8, fontSize: 11, fontWeight: 600, padding: "8px 10px", cursor: "pointer", whiteSpace: "nowrap" },
  proposalDeleteBtn: { background: "transparent", border: "none", color: "#6A5A45", fontSize: 14, cursor: "pointer", padding: "4px 6px" },
  proposalForm: { display: "flex", gap: 8, marginTop: 4 },
  setlistList: { display: "flex", flexDirection: "column", gap: 6 },
  setlistRow: { display: "flex", alignItems: "center", justifyContent: "space-between", background: "#1C1812", border: "1px solid #3A3024", borderRadius: 10, padding: "12px 14px", cursor: "grab", userSelect: "none" },
  setlistLeft: { display: "flex", alignItems: "center", gap: 12 },
  setlistNum: { fontSize: 18, fontWeight: 900, color: "#4A3F2E", fontFamily: "monospace", width: 22, textAlign: "right" },
  setlistTitle: { fontSize: 14, fontWeight: 600, color: "#EDE0CC" },
  setlistArtist: { fontSize: 12, color: "#8A7A60", marginTop: 2 },
  setlistRight: { display: "flex", alignItems: "center", gap: 8, flexShrink: 0 },
  pdfLink: { fontSize: 11, color: "#B5944B", textDecoration: "none", background: "#251E0D", border: "1px solid #B5944B44", borderRadius: 6, padding: "4px 8px" },
  pdfUploadBtn: { fontSize: 11, color: "#8A7A60", background: "#2A2319", border: "1px solid #3A3024", borderRadius: 6, padding: "4px 8px", cursor: "pointer" },
  dragHandle: { fontSize: 16, color: "#4A3F2E", cursor: "grab" },
};
