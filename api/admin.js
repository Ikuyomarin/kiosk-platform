// 파일 경로: /api/admin.js
// (이 코드는 Vercel 서버에서만 실행됩니다)

import { createClient } from '@supabase/supabase-js';

// Vercel에 저장된 '비밀 키'를 사용해 서버용 클라이언트 생성
const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // 🚨 'SERVICE_ROLE_KEY' (관리자 전용 비밀 키)
);

// 🚀 [수정] 헬퍼 함수 추가 (timeToMinutes 오류 해결)
function timeToMinutes(time) {
  if (!time || !time.includes(':')) { return 0; }
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}
function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60).toString().padStart(2, '0');
  const m = (minutes % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

// 🚀 [수정] 60분 게임의 아랫칸 시간(30분 뒤)을 계산하는 헬퍼 함수 (오타 수정)
function getNextTimeLabel(timeLabel) {
  if (!timeLabel || !timeLabel.includes(':')) return null;
  const [hours, minutes] = timeLabel.split(':').map(Number); // 🚀 [수정] 오타 제거
  const totalMinutes = hours * 60 + minutes + 30; // 30분 뒤
  const h = Math.floor(totalMinutes / 60).toString().padStart(2, '0');
  const m = (totalMinutes % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { action, payload, password } = req.body;

  try {
    // --- 1. 비밀번호 확인 ---
    const { data: setting } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'admin_password')
      .single();

    const adminPassword = setting ? setting.value : '0924';

    if (adminPassword !== password) {
      return res.status(401).json({ error: 'Unauthorized: Invalid Password' });
    }

    // --- 2. 비밀번호 일치 시, 요청한 작업(action) 수행 ---

    if (action === 'login-test') {
      return res.status(200).json({ message: 'Login successful' });
    }

    // (시간대 마감)
    if (action === 'block_time') {
      const time = payload;
      const { error } = await supabase.from('blocked_slots').insert({
        time_label: time.time_label, game_id: null,
        block_date: new Date().toISOString().split('T')[0]
      });
      if (error) throw error;
      return res.status(200).json({ message: '시간대가 마감되었습니다.' });
    }
    
    // (시간대 마감 해제)
    else if (action === 'unblock_time') {
      const time = payload;
      const { error } = await supabase.from('blocked_slots')
        .delete().eq('time_label', time.time_label).is('game_id', null);
      if (error) throw error;
      return res.status(200).json({ message: '시간대 마감이 해제되었습니다.' });
    }
    
    // (시간대 영구 삭제)
    else if (action === 'delete_time') {
      const time = payload;
      await Promise.all([
        supabase.from('reservations').delete().eq('time_label', time.time_label),
        supabase.from('blocked_slots').delete().eq('time_label', time.time_label),
        supabase.from('operating_times').delete().eq('id', time.id)
      ]);
      return res.status(200).json({ message: '시간대가 영구적으로 삭제되었습니다.' });
    }
    
    // (게임 이름 변경)
    else if (action === 'rename_game') {
      const { game, newName } = payload; 
      const { error } = await supabase.from('games').update({ name: newName }).eq('id', game.id); 
      if (error) throw error;
      return res.status(200).json({ message: '게임 이름이 변경되었습니다.' });
    }
    
    // (게임 비활성화)
    else if (action === 'block_game') {
      const game = payload;
      const { error } = await supabase.from('blocked_slots').insert({
        time_label: null, game_id: game.id,
        block_date: new Date().toISOString().split('T')[0]
      });
      if (error) throw error;
      return res.status(200).json({ message: '게임이 마감되었습니다.' });
    }
    
    // (게임 비활성화 해제)
    else if (action === 'unblock_game') {
      const game = payload;
      const { error } = await supabase.from('blocked_slots')
        .delete().eq('game_id', game.id).is('time_label', null);
      if (error) throw error;
      return res.status(200).json({ message: '게임 이용 중지가 해제되었습니다.' });
    }
    
    // (게임 영구 삭제)
    else if (action === 'delete_game') {
      const game = payload;
      await supabase.from('blocked_slots').delete().eq('game_id', game.id);
      const { error } = await supabase.from('games').delete().eq('id', game.id); 
      if (error) throw error;
      return res.status(200).json({ message: '게임이 영구적으로 삭제되었습니다.' });
    }
    
    // (예약 취소)
    else if (action === 'cancel_reservation') {
      const { reservation, game } = payload; 
      
      const idsToDelete = [reservation.id];

      if (game.time_unit === 60) {
        const startMin = timeToMinutes(reservation.time_label); 
        
        let partnerTimeLabel;
        if (startMin % 60 === 0) { // 10:00 (윗칸)
            partnerTimeLabel = minutesToTime(startMin + 30); 
        } else { // 10:30 (아랫칸)
            partnerTimeLabel = minutesToTime(startMin - 30); 
        }

        const { data: partnerRes } = await supabase.from('reservations') 
          .select('id')
          .eq('game_id', game.id)
          .eq('user_name', reservation.user_name)
          .eq('time_label', partnerTimeLabel)
          .neq('id', reservation.id); 
          
        if (partnerRes && partnerRes.length > 0) {
          idsToDelete.push(partnerRes[0].id);
        }
      }
      
      const { error } = await supabase.from('reservations').delete().in('id', idsToDelete); 
      if (error) throw error;
      
      return res.status(200).json({ message: '예약이 취소되었습니다.' });
    }
    
    // (관리자 패널 - 게임 추가)
    else if (action === 'add_game') {
      const { name, time_unit } = payload; 
      const { error } = await supabase.from('games').insert({ name, time_unit }); 
      if (error) throw error;
      return res.status(200).json({ message: '게임이 추가되었습니다.' });
    }
    
    // (관리자 패널 - 시간 추가)
    else if (action === 'add_time_range') {
      const { timesToAdd } = payload; 
      const { error } = await supabase.from('operating_times').insert(timesToAdd); 
      if (error) throw error;
      return res.status(200).json({ message: '시간대가 추가되었습니다.' });
    }
    
    // (예약 수정)
    else if (action === 'edit_reservation') {
      const { reservation, newName, newCount } = payload;
      
      const updates = [{ id: reservation.id, user_name: newName, user_count: newCount }];
      
      const { data: game } = await supabase.from('games').select('time_unit').eq('id', reservation.game_id).single();
      if (game && game.time_unit === 60) {
        
        const startMin = timeToMinutes(reservation.time_label); 
        let partnerTimeLabel;
        if (startMin % 60 === 0) { 
            partnerTimeLabel = minutesToTime(startMin + 30); 
        } else { 
            partnerTimeLabel = minutesToTime(startMin - 30); 
        }
        
        const { data: nextRes } = await supabase.from('reservations')
          .select('id')
          .eq('game_id', reservation.game_id)
          .eq('user_name', reservation.user_name) 
          .eq('time_label', partnerTimeLabel)
          .neq('id', reservation.id) 
          .single();
          
        if (nextRes) {
          updates.push({ id: nextRes.id, user_name: newName, user_count: newCount });
        }
      }

      const { error } = await supabase.from('reservations').upsert(updates);
      if (error) throw error;
      
      return res.status(200).json({ message: '예약이 수정되었습니다.' });
    }

    // 그 외
    return res.status(400).json({ error: 'Invalid action' });

  } catch (error) {
    if (error.code === '23505') { // 중복 오류
      return res.status(409).json({ error: 'Conflict: 이미 존재하거나 중복된 항목입니다.' });
    }
    console.error("API Error:", error); 
    return res.status(500).json({ error: error.message });
  }
}