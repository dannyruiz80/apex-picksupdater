import { ApexSport } from '../types';
import { fetchSchedule } from './sportsHub';
import { gameMarketPredictionRepository } from './gameMarketPredictionRepository';

export class GameMarketLearningService {
  private running=false;
  async gradePending(maxScheduleGroups=8){
    if(this.running)return {status:'BUSY',graded:0}; this.running=true;
    try{
      const rows=gameMarketPredictionRepository.getAll().filter(r=>r.gradingStatus==='PENDING'&&Date.parse(r.eventStartTime)<Date.now());
      const groups=new Map<string,typeof rows>();
      for(const r of rows){const date=r.eventStartTime.slice(0,10);const key=`${r.sport}|${date}`;const list=groups.get(key)||[];list.push(r);groups.set(key,list);}
      let graded=0,checked=0;
      for(const [key,list] of [...groups.entries()].slice(0,maxScheduleGroups)){
        const [sport,date]=key.split('|') as [ApexSport,string]; checked++;
        try{
          const schedule=await fetchSchedule(sport,date);
          for(const row of list){const game=schedule.games.find(g=>g.eventId===row.eventId);if(!game||game.status!=='FINAL'||game.homeScore===null||game.awayScore===null)continue;
            if(gameMarketPredictionRepository.grade(row.snapshotId,game.homeScore,game.awayScore))graded++;}
        }catch(err:any){console.warn(`[Apex Picks] Game-model grading skipped ${key}: ${err?.message||err}`);}
      }
      return {status:'SUCCESS',graded,scheduleGroupsChecked:checked,evidence:gameMarketPredictionRepository.getStatus()};
    } finally {this.running=false;}
  }
}
export const gameMarketLearningService=new GameMarketLearningService();
