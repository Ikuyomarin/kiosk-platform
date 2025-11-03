import React, { useState, useEffect } from 'react';
import { supabase } from './supabase.js';
import './App.css';

// --- 유틸리티 함수 ---
function timeToMinutes(time) {
  if (!time || !time.includes(':')) { console.error("Invalid time format:", time); return 0; }
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}
function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60).toString().padStart(2, '0');
  const m = (minutes % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}
function formatAmPm(timeLabel) {
  if (!timeLabel) return '';
  const [hourStr, minuteStr] = timeLabel.split(':');
  let hour = parseInt(hourStr, 10);
  const ampm = hour >= 12 ? '오후' : '오전';
  if (hour === 0) { hour = 12; } else if (hour > 12) { hour -= 12; }
  return `${ampm} ${hour}:${minuteStr}`;
}
// --- 유틸리티 함수 끝 ---

function App() {
  // --- 1. 상태 관리 ---
  const [games, setGames] = useState([]);
  const [times, setTimes] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [blockedSlots, setBlockedSlots] = useState([]);
  const [currentTime, setCurrentTime] = useState(new Date());

  // 로딩 및 관리자
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [password, setPassword] = useState(''); // 🚀 [수정] 로그인 성공 시 여기에 '비밀번호'가 저장됨
  const [isAdmin, setIsAdmin] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);

  // 관리자 폼
  const [newGameName, setNewGameName] = useState('');
  const [newGameUnit, setNewGameUnit] = useState(30);
  const [newTimeStart, setNewTimeStart] = useState('');
  const [newTimeEnd, setNewTimeEnd] = useState('');

  // 예약 팝업
  const [showResModal, setShowResModal] = useState(false);
  const [selectedCell, setSelectedCell] = useState(null);
  const [resName, setResName] = useState('');
  const [resCount, setResCount] = useState(1);
  
  // 관리자 더블클릭 팝업
  const [showGameMenu, setShowGameMenu] = useState(null);
  const [showRenameModal, setShowRenameModal] = useState(null);
  const [renameGameName, setRenameGameName] = useState('');
  const [showTimeMenu, setShowTimeMenu] = useState(null);

  // 예약 수정 팝업
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingReservation, setEditingReservation] = useState(null);
  const [editName, setEditName] = useState('');
  const [editCount, setEditCount] = useState(1);

  // --- 2. 데이터 페칭 및 타이머 설정 ---
  useEffect(() => {
    fetchInitialData();
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000); // 1초마다 갱신
    
    // RLS가 켜진 테이블만 구독
    const blockedSlotListener = supabase
      .channel('public:blocked_slots')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'blocked_slots' },
        (payload) => {
          console.log('실시간: 마감 변경 감지됨!', payload);
          fetchInitialData(); 
        }
      )
      .subscribe();
      
    // 🚀 [수정] RLS를 끈 reservations는 실시간 구독 대신 '수동' 새로고침으로 처리합니다.
      
    return () => {
      clearInterval(timer);
      supabase.removeChannel(blockedSlotListener);
    };
  }, []);

  async function fetchInitialData() {
    setLoading(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      // 🚀 [수정] 이제 '설정(settings)' 테이블은 불러오지 않습니다. (보안)
      const [gameData, timeData, resData, blockData] = await Promise.all([
        supabase.from('games').select('*').order('id'),
        supabase.from('operating_times').select('*').order('time_label'),
        supabase.from('reservations').select('*').eq('reservation_date', today),
        supabase.from('blocked_slots').select('*').eq('block_date', today)
      ]);
      setGames(gameData.data || []);
      setTimes(timeData.data || []);
      setReservations(resData.data || []);
      setBlockedSlots(blockData.data || []);
    } catch (error) { console.error("데이터 로딩 중 오류 발생:", error.message); } 
    finally { setLoading(false); }
  }

  // --- 3. 이벤트 핸들러 ---

  // (관리자) 톱니바퀴 클릭
  function handleSettingsClick() {
    setPendingAction(null); 
    if (isAdmin) { setShowAdminPanel(true); } else { setShowSettings(true); }
  }

  // 🚀 [수정] (관리자) 비밀번호 제출 (API 호출로 변경)
  async function handlePasswordSubmit(e) {
    e.preventDefault();
    try {
      const response = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: password, // 입력한 비밀번호
          action: 'login-test' 
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'API 오류');
      
      setIsAdmin(true);
      setShowSettings(false);
      // 🚀 [수정] 비밀번호를 state에 저장 (로그인 상태 유지)
      // setPassword(''); // 비우지 않음
      
      if (pendingAction) {
        executeAdminAction(pendingAction, password); 
      } else {
        setShowAdminPanel(true);
      }
      
    } catch (error) {
      alert(error.message);
      setPendingAction(null);
      setPassword(''); // 🚀 실패 시에만 비밀번호 비우기
    }
  }

  // 🚀 [수정] (관리자) 대기 중인 작업 실행 (API 호출로 변경)
  async function executeAdminAction(action, adminPassword = null) {
    if (!action) return;
    
    const passwordToUse = isAdmin ? password : adminPassword;
    if (!passwordToUse) {
      setPendingAction(action); 
      setShowSettings(true);    
      return;
    }
    
    try {
      let confirmMessage = "";
      let requiresConfirm = true;
      
      if (action.type === 'block_time') {
        const time = action.payload;
        confirmMessage = `'${time.time_label}~${minutesToTime(timeToMinutes(time.time_label) + 30)}' 시간대 전체를\n이용 중지(마감)하시겠습니까?`;
      }
      else if (action.type === 'unblock_time') {
        const time = action.payload;
        confirmMessage = `'${time.time_label}' 시간대 마감을 해제하시겠습니까?`;
      }
      else if (action.type === 'delete_time') {
        const time = action.payload;
        confirmMessage = `[경고]\n'${time.time_label}' 시간대를 영구히 삭제하시겠습니까?`;
      }
      else if (action.type === 'open_game_menu') {
        setShowGameMenu(action.payload);
        requiresConfirm = false; 
      }
      else if (action.type === 'open_time_menu') {
        setShowTimeMenu(action.payload);
        requiresConfirm = false; 
      }
      else if (action.type === 'open_edit_modal') {
        const res = action.payload;
        setEditingReservation(res);
        setEditName(res.user_name);
        setEditCount(res.user_count);
        setShowEditModal(true);
        requiresConfirm = false;
      }
      else if (action.type === 'rename_game') {
        requiresConfirm = false; // 팝업에서 submit할 때 처리
      }
      else if (action.type === 'block_game') {
         const game = action.payload;
         confirmMessage = `'${game.name}' 게임 전체를\n오늘 하루 이용 중지(마감)하시겠습니까?`;
      }
      else if (action.type === 'unblock_game') {
        const game = action.payload;
        confirmMessage = `'${game.name}' 게임 이용 중지를 해제하시겠습니까?`;
      }
      else if (action.type === 'delete_game') {
        const game = action.payload;
        confirmMessage = `[경고]\n'${game.name}' 게임을 영구히 삭제하시겠습니까?`;
      }
      else if (action.type === 'cancel_reservation') {
        const res = action.payload;
        confirmMessage = `[예약 취소]\n시간: ${res.time_label}\n이름: ${res.user_name} (${res.user_count}명)\n\n이 예약을 정말 취소하시겠습니까?`;
      } 
      else if (action.type === 'edit_reservation') {
        requiresConfirm = false; // 팝업에서 submit할 때 처리
      }
      else {
        requiresConfirm = false; 
      }
      
      if (!requiresConfirm || confirm(confirmMessage)) {
        if (requiresConfirm) {
          const response = await fetch('/api/admin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              password: passwordToUse, 
              action: action.type,
              payload: action.payload
            })
          });

          const result = await response.json();
          if (!response.ok) throw new Error(result.error);
          
          alert(result.message); 
          setShowTimeMenu(null);
          setShowGameMenu(null);
          
          // 🚀 [수정] 수동 새로고침
          fetchInitialData();
        }
      }
    } catch (error) {
      alert("작업 처리 중 오류: " + error.message);
    } finally {
      setPendingAction(null);
    }
  }

  // 🚀 [수정] (관리자) 게임 추가 (API 호출)
  async function handleAddGame(e) {
    e.preventDefault();
    if (!newGameName) return alert('게임 이름을 입력하세요.');
    try {
      const response = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: password, 
          action: 'add_game',
          payload: { name: newGameName, time_unit: newGameUnit }
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      alert(result.message);
      setNewGameName('');
      fetchInitialData(); 
    } catch (error) { alert("게임 추가 중 오류 발생: " + error.message); }
  }

  // 🚀 [수정] (관리자) 시간 범위 추가 (API 호출)
  async function handleAddTimeRange(e) {
    e.preventDefault();
    const start = newTimeStart, end = newTimeEnd;
    if (!start.match(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/) || !end.match(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)) {
      return alert("시간을 'HH:MM' 형식 (예: 22:00)으로 입력하세요.");
    }
    const startMinutes = timeToMinutes(start), endMinutes = timeToMinutes(end);
    if (startMinutes >= endMinutes) return alert("시작 시간은 종료 시간보다 빨라야 합니다.");
    const timesToAdd = [];
    for (let m = startMinutes; m < endMinutes; m += 30) { timesToAdd.push({ time_label: minutesToTime(m) }); }
    if (timesToAdd.length === 0) return alert("추가할 시간이 없습니다.");
    try {
      const response = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: password,
          action: 'add_time_range',
          payload: { timesToAdd }
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      alert(result.message);
      setNewTimeStart(''); setNewTimeEnd('');
      fetchInitialData(); 
    } catch (error) { alert("시간 추가 중 오류 발생: " + error.message); }
  }

  // (사용자) 비어있는 셀 클릭
  function handleCellClick(game, time, isReserved, isBlocked) {
    if (isReserved || isBlocked) return;
    if (game.time_unit === 60) {
      const currentTotalMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();
      const nextTimeLabel = minutesToTime(timeToMinutes(time.time_label) + 30);
      const nextTime = times.find(t => t.time_label === nextTimeLabel);
      if (!nextTime) { alert("60분 게임은 마지막 30분 시간대에 예약할 수 없습니다."); return; }
      const cellEndTimeMinutes = timeToMinutes(time.time_label) + 60;
      if (cellEndTimeMinutes <= currentTotalMinutes) { alert("이미 시간이 지난 슬롯입니다."); return; }
      const isNextTimeBlocked = blockedSlots.some(b => b.time_label === nextTimeLabel && b.game_id === null);
      if (isNextTimeBlocked) { alert("다음 시간대가 마감되어 60분 예약을 할 수 없습니다."); return; }
    }
    setSelectedCell({ game, time });
    setResName(''); setResCount(1); setShowResModal(true);
  }

  // (사용자) 예약 팝업 제출
  async function handleReservationSubmit(e) {
    e.preventDefault();
    if (!resName || resCount < 1) return alert("이름과 인원수(1명 이상)를 정확히 입력하세요.");
    const { game, time } = selectedCell;
    const reservationsToInsert = [];
    reservationsToInsert.push({
      game_id: game.id, time_label: time.time_label,
      user_name: resName, user_count: resCount,
      reservation_date: new Date().toISOString().split('T')[0]
    });
    if (game.time_unit === 60) {
      reservationsToInsert.push({
        game_id: game.id,
        time_label: minutesToTime(timeToMinutes(time.time_label) + 30),
        user_name: resName, user_count: resCount,
        reservation_date: new Date().toISOString().split('T')[0]
      });
    }
    try {
      const { data: newReservations, error } = await supabase
        .from('reservations')
        .insert(reservationsToInsert)
        .select(); 

      if (error) throw error;
      alert("예약되었습니다!"); 
      setShowResModal(false); 
      setSelectedCell(null); 
      setReservations(prevReservations => [...prevReservations, ...newReservations]);
      
    } catch (error) {
      if (error.code === '23505') { alert("오류: 해당 시간대에 이미 다른 예약이 있습니다. (중복)"); } 
      else { alert("예약 중 오류 발생: " + error.message); }
    }
  }

  // (관리자) 시간 헤더 더블클릭
  function handleTimeHeaderDoubleClick(time) {
    const action = { type: 'open_time_menu', payload: time };
    executeAdminAction(action);
  }

  // (관리자) 게임 헤더 더블클릭
  function handleGameHeaderDoubleClick(game) {
    const action = { type: 'open_game_menu', payload: game };
    executeAdminAction(action);
  }

  // --- (관리자 메뉴 핸들러) ---
  function handleRenameClick() {
    setShowRenameModal(showGameMenu);
    setRenameGameName(showGameMenu.name);
    setShowGameMenu(null);
  }
  async function handleRenameSubmit(e) {
    e.preventDefault();
    if (!renameGameName) return alert("새 게임 이름을 입력하세요.");
    const action = {
      type: 'rename_game',
      payload: { game: showRenameModal, newName: renameGameName }
    };
    await executeAdminAction(action, password);
    setShowRenameModal(null);
  }
  async function handleBlockGameClick() {
    const action = { type: 'block_game', payload: showGameMenu };
    await executeAdminAction(action, password);
  }
  async function handleUnblockGameClick() {
    const action = { type: 'unblock_game', payload: showGameMenu };
    await executeAdminAction(action, password);
  }
  async function handleDeleteGameClick() { 
    const action = { type: 'delete_game', payload: showGameMenu };
    await executeAdminAction(action, password);
  }
  async function handleBlockTimeClick() { 
    const action = { type: 'block_time', payload: showTimeMenu };
    await executeAdminAction(action, password);
  }
  async function handleUnblockTimeClick() { 
    const action = { type: 'unblock_time', payload: showTimeMenu };
    await executeAdminAction(action, password);
  }
  async function handleDeleteTimeClick() { 
    const action = { type: 'delete_time', payload: showTimeMenu };
    await executeAdminAction(action, password);
  }
  
  // 팝업 닫기 (비밀번호 취소)
  function handleCancelPassword() {
    setShowSettings(false);
    setPendingAction(null);
  }
  
  // (관리자) 예약된 셀 우클릭 (예약 취소)
  function handleCellRightClick(e, reservation) {
    e.preventDefault(); 
    if (!reservation) return; 
    const action = { type: 'cancel_reservation', payload: reservation };
    executeAdminAction(action);
  }
  
  // (관리자) 예약된 셀 더블클릭 (수정 팝업 열기)
  function handleCellDoubleClick(reservation) {
    if (!reservation) return; 
    const action = { type: 'open_edit_modal', payload: reservation };
    executeAdminAction(action);
  }

  // (관리자) 예약 수정 팝업 제출
  async function handleEditSubmit(e) {
    e.preventDefault();
    if (!editName || editCount < 1) return alert("이름과 인원수(1명 이상)를 정확히 입력하세요.");
    
    const action = {
      type: 'edit_reservation',
      payload: { 
        reservation: editingReservation, 
        newName: editName, 
        newCount: editCount 
      }
    };
    
    await executeAdminAction(action, password);
    
    setShowEditModal(false); 
    setEditingReservation(null);
  }

  // --- 4. 렌더링 (화면 그리기) ---
  if (loading) {
    return <div className="loading-screen">로딩 중...</div>;
  }

  const currentTotalMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();

  return (
    <div className="kiosk-container">
      {/* ----- 헤더 ----- */}
      <h1>플레이존 예약 시스템</h1>
      <h2 style={{ textAlign: 'center', color: '#333' }}>
        현재 시간: {currentTime.toLocaleTimeString('ko-KR')}
      </h2>

      {/* ----- 스크롤 컨테이너 ----- */}
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th className="time-header">시간</th>
              {games.map(game => (
                <th 
                  key={game.id} 
                  className={`game-header ${isAdmin ? 'admin-hover' : ''}`}
                  onDoubleClick={() => handleGameHeaderDoubleClick(game)}
                >
                  {game.name}
                </th>
              ))}
            </tr>
          </thead>
          
          <tbody>
            {times.map((time, timeIndex) => { 
              
              const startMinutes = timeToMinutes(time.time_label);
              const endMinutes = startMinutes + 30;
              const endTimeLabel = minutesToTime(endMinutes);
              const displayLabel = `${time.time_label}~${endTimeLabel}`;
              const amPmLabel = `(${formatAmPm(time.time_label)}~${formatAmPm(endTimeLabel)})`;

              const isSlotEndTimePast = endMinutes <= currentTotalMinutes;
              const isTimeBlocked = blockedSlots.some(b => b.time_label === time.time_label && b.game_id === null);
              const isTimeHeaderBlocked = isTimeBlocked || isSlotEndTimePast;
              const isCurrentTimeRow = currentTotalMinutes >= startMinutes && currentTotalMinutes < endMinutes;

              return (
                <tr key={time.id}>
                  <td 
                    className={`time-cell ${isAdmin ? 'admin-hover' : ''} ${isTimeHeaderBlocked ? 'blocked-cell-time' : ''} ${isCurrentTimeRow ? 'current-time-row-header' : ''}`}
                    onDoubleClick={() => handleTimeHeaderDoubleClick(time)}
                  >
                    {displayLabel} <br/>
                    <span className="time-cell-ampm">{amPmLabel}</span>
                  </td> 
                  
                  {games.map(game => {
                    
                    if (game.time_unit === 60 && timeIndex % 2 === 1) {
                      return null; 
                    }
                    
                    const rowSpan = (game.time_unit === 60) ? 2 : 1;

                    const reservation = reservations.find(
                      r => r.game_id === game.id && r.time_label === time.time_label
                    );
                    const isGameBlocked = blockedSlots.some(
                      b => b.game_id === game.id && b.time_label === null
                    );
                    
                    let finalIsBlocked = isTimeBlocked || isGameBlocked;
                    let finalReservation = reservation; 

                    const cellEndTimeMinutes = startMinutes + game.time_unit;
                    const isCurrentTimeCell = currentTotalMinutes >= startMinutes && currentTotalMinutes < cellEndTimeMinutes;
                    const isPast = cellEndTimeMinutes <= currentTotalMinutes; 

                    if (game.time_unit === 60) {
                      const nextTimeLabel = minutesToTime(startMinutes + 30);
                      const nextTime = times.find(t => t.time_label === nextTimeLabel);
                      
                      if (nextTime) {
                        const isNextTimeBlocked = blockedSlots.some(b => b.time_label === nextTimeLabel && b.game_id === null);
                        finalIsBlocked = isTimeBlocked || isNextTimeBlocked || isGameBlocked || isPast;
                         
                        const nextTimeReservation = reservations.find(r => r.game_id === game.id && r.time_label === nextTimeLabel);
                        if (nextTimeReservation) {
                           finalReservation = reservation || nextTimeReservation;
                        }
                      } else {
                        finalIsBlocked = finalIsBlocked || isSlotEndTimePast;
                      }
                    } else {
                      finalIsBlocked = finalIsBlocked || isSlotEndTimePast;
                    }

                    let cellClass = 'empty-cell';
                    if (finalReservation) { cellClass = 'reserved-cell'; } 
                    else if (finalIsBlocked) { cellClass = 'blocked-cell'; }
                    else if (isCurrentTimeCell) { cellClass = 'current-time-cell'; }

                    return (
                      <td 
                        key={`${game.id}-${time.id}`} 
                        className={cellClass}
                        rowSpan={rowSpan} 
                        onClick={() => handleCellClick(game, time, !!finalReservation, finalIsBlocked)}
                        onDoubleClick={finalReservation ? () => handleCellDoubleClick(finalReservation) : null}
                        onContextMenu={finalReservation ? (e) => handleCellRightClick(e, finalReservation) : (e) => e.preventDefault()}
                      >
                        {finalReservation ? `${finalReservation.user_name} (${finalReservation.user_count}명)` : ''}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div> 

      {/* ----- 톱니바퀴 설정 버튼 ----- */}
      <button className="settings-button" onClick={handleSettingsClick}> ⚙️ </button>

      {/* ----- (팝업 1) 관리자 패널 ----- */}
      {showAdminPanel && (
        <div className="modal-overlay" onClick={() => setShowAdminPanel(false)}>
          <div className="modal-content admin-panel" onClick={e => e.stopPropagation()}>
            <h2>관리자 설정</h2>
            <form onSubmit={handleAddGame} className="admin-form">
              <h3>게임 추가 (세로줄)</h3>
              <input type="text" placeholder="게임 이름 (예: 닌텐도)" value={newGameName} onChange={(e) => setNewGameName(e.target.value)} />
              <select value={newGameUnit} onChange={(e) => setNewGameUnit(parseInt(e.target.value))} >
                <option value={30}>30분</option><option value={60}>60분</option>
              </select>
              <button type="submit">게임 추가</button>
            </form>
            <form onSubmit={handleAddTimeRange} className="admin-form">
              <h3>시간 범위 추가 (가로줄)</h3>
              <input type="text" placeholder="시작 시간 (예: 22:00)" value={newTimeStart} onChange={(e) => setNewTimeStart(e.target.value)} />
              <input type="text" placeholder="종료 시간 (예: 23:00)" value={newTimeEnd} onChange={(e) => setNewTimeEnd(e.target.value)} />
              <button type="submit">시간 범위 추가</button>
            </form>
            <button type="button" className="close-button" onClick={() => setShowAdminPanel(false)}> 닫기 </button>
          </div>
        </div>
      )}

      {/* ----- (팝업 2) 비밀번호 팝업 ----- */}
      {showSettings && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>관리자 로그인</h3>
            <form onSubmit={handlePasswordSubmit}>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="비밀번호"
                autoFocus
              />
              <button type="submit">로그인</button>
              <button type="button" onClick={handleCancelPassword}>취소</button>
            </form>
          </div>
        </div>
      )}
      
      {/* ----- (팝업 3) 예약하기 팝업 ----- */}
      {showResModal && selectedCell && (
        <div className="modal-overlay" onClick={() => setShowResModal(false)}>
          <div className="modal-content reservation-modal" onClick={e => e.stopPropagation()}>
            <h2>예약하기</h2>
            <p><strong>게임:</strong> {selectedCell.game.name}</p>
            <p><strong>시간:</strong> {selectedCell.time.time_label}~{minutesToTime(timeToMinutes(selectedCell.time.time_label) + selectedCell.game.time_unit)}</p>
            <form onSubmit={handleReservationSubmit}>
              <input
                type="text"
                placeholder="예약자 이름"
                value={resName}
                inputMode="korean" 
                onChange={(e) => {
                  const korean = e.target.value.replace(/[^ㄱ-ㅎㅏ-ㅣ가-힣\s]/g, ''); 
                  setResName(korean);
                }}
                autoFocus
              />
              <input
                type="number"
                placeholder="인원수"
                value={resCount}
                onChange={(e) => setResCount(parseInt(e.target.value))}
                min="1"
              />
              <button type="submit">예약하기</button>
              <button type="button" onClick={() => setShowResModal(false)}>취소</button>
            </form>
          </div>
        </div>
      )}

      {/* ----- (팝업 4) 게임 메뉴 팝업 ----- */}
      {showGameMenu && (
        <div className="modal-overlay" onClick={() => setShowGameMenu(null)}>
          <div className="modal-content game-menu" onClick={e => e.stopPropagation()}>
            <h3>'{showGameMenu.name}' 설정</h3>
            <button onClick={handleRenameClick}>이름 변경</button>
            {blockedSlots.some(b => b.game_id === showGameMenu.id && b.time_label === null) ? (
              <button onClick={handleUnblockGameClick} style={{ backgroundColor: '#c8e6c9' }}>이용 중지 해제</button>
            ) : (
              <button onClick={handleBlockGameClick} style={{ backgroundColor: '#ffcdd2' }}>오늘 이용 중지</button>
            )}
            <button onClick={handleDeleteGameClick} style={{ backgroundColor: '#f44336', color: 'white' }}>게임 영구 삭제</button>
            <button type="button" className="close-button" onClick={() => setShowGameMenu(null)}>취소</button>
          </div>
        </div>
      )}
      
      {/* ----- (팝업 5) 이름 변경 팝업 ----- */}
      {showRenameModal && (
        <div className="modal-overlay" onClick={() => setShowRenameModal(null)}>
          <div className="modal-content rename-modal" onClick={e => e.stopPropagation()}>
            <h3>게임 이름 변경</h3>
            <form onSubmit={handleRenameSubmit}>
              <input
                type="text"
                value={renameGameName}
                onChange={(e) => setRenameGameName(e.target.value)}
                autoFocus
              />
              <button type="submit">변경하기</button>
              <button type="button" onClick={() => setShowRenameModal(null)}>취소</button>
            </form>
          </div>
        </div>
      )}

      {/* ----- (팝업 6) 시간 메뉴 팝업 ----- */}
      {showTimeMenu && (
        <div className="modal-overlay" onClick={() => setShowTimeMenu(null)}>
          <div className="modal-content game-menu" onClick={e => e.stopPropagation()}>
            <h3>'{minutesToTime(timeToMinutes(showTimeMenu.time_label))}~{minutesToTime(timeToMinutes(showTimeMenu.time_label) + 30)}' 설정</h3>
            {blockedSlots.some(b => b.time_label === showTimeMenu.time_label && b.game_id === null) ? (
              <button onClick={handleUnblockTimeClick} style={{ backgroundColor: '#c8e6c9' }}>오늘 마감 해제</button>
            ) : (
              <button onClick={handleBlockTimeClick} style={{ backgroundColor: '#ffcdd2' }}>오늘 하루 마감</button>
            )}
            <button onClick={handleDeleteTimeClick} style={{ backgroundColor: '#f44336', color: 'white' }}>시간대 영구 삭제</button>
            <button type="button" className="close-button" onClick={() => setShowTimeMenu(null)}>취소</button>
          </div>
        </div>
      )}
      
      {/* 🚀 [신규] (팝업 7) 예약 수정 팝업 ----- */}
      {showEditModal && editingReservation && (
        <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="modal-content reservation-modal" onClick={e => e.stopPropagation()}>
            <h2>예약 수정</h2>
            <p><strong>게임:</strong> {games.find(g => g.id === editingReservation.game_id)?.name}</p>
            <p><strong>시간:</strong> {editingReservation.time_label}</p>
            <form onSubmit={handleEditSubmit}>
              <input
                type="text"
                placeholder="예약자 이름"
                value={editName}
                inputMode="korean" 
                onChange={(e) => {
                  const korean = e.target.value.replace(/[^ㄱ-ㅎㅏ-ㅣ가-힣\s]/g, ''); 
                  setEditName(korean);
                }}
                autoFocus
              />
              <input
                type="number"
                placeholder="인원수"
                value={editCount}
                onChange={(e) => setEditCount(parseInt(e.target.value))}
                min="1"
              />
              <button type="submit">수정하기</button>
              <button type="button" onClick={() => setShowEditModal(false)}>취소</button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

export default App;