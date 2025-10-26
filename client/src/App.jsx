import React, { useState, useEffect, useRef } from "react";
import io from "socket.io-client";
import Peer from "simple-peer";
import ReactPlayer from "react-player";

export default function App() {
  const [name,setName] = useState("");
  const [nameSet,setNameSet] = useState(false);
  const [socketId,setSocketId] = useState("");
  const [hostId,setHostId] = useState("");
  const [peers,setPeers] = useState([]);
  const [peerStreams,setPeerStreams] = useState({});
  const [msg,setMsg] = useState("");
  const [chat,setChat] = useState([]);
  const [targetId,setTargetId] = useState("");
  const [videoUrl,setVideoUrl] = useState("");
  const [sharedVideoUrl,setSharedVideoUrl] = useState("");
  const [meStatus,setMeStatus] = useState({ camOn:false, micOn:false });
  const [mediaStream,setMediaStream] = useState(null);

  const socketRef = useRef(null);
  const myVideoRef = useRef(null);
  const playerRef = useRef(null);
  const peersRef = useRef({});
  const SIGNALING_SERVER = import.meta.env.VITE_SIGNALING_SERVER || "/api";
  // --- Init Socket ---
  useEffect(()=>{
    const socket = io(SIGNALING_SERVER);
    socketRef.current = socket;

    socket.on("connect-success", ({id})=>setSocketId(id));
    socket.on("update-peers", setPeers);
    socket.on("peer-updated", (p)=>{
      setPeers(prev => prev.map(peer => peer.id===p.id? {...peer,...p}:peer));
    });
    socket.on("peer-left", ({id})=>{
      setPeers(prev => prev.filter(p=>p.id!==id));
      setPeerStreams(prev=>{
        const { [id]: removed, ...rest } = prev;
        if(peersRef.current[id]) { peersRef.current[id].destroy(); delete peersRef.current[id]; }
        return rest;
      });
    });
    socket.on("receive-message", ({ from, fromName, msg })=>{
      setChat(prev=>[...prev, {from, fromName, msg}]);
    });
    socket.on("receive-video", ({ url, action, time })=>{
      if(url) setSharedVideoUrl(url);
      if(playerRef.current){
        if(action==="PLAY") playerRef.current.seekTo(time);
        if(action==="PAUSE") playerRef.current.seekTo(time);
        if(action==="SEEK") playerRef.current.seekTo(time);
      }
    });
    socket.on("offer", ({from,signal})=>{
      if(peersRef.current[from]) return;
      const peer = new Peer({ initiator:false, trickle:false });
      if(mediaStream) mediaStream.getTracks().forEach(t=>peer.addTrack(t,mediaStream));
      peer.on("signal", signal=>socket.emit("answer",{to:from,signal}));
      peer.on("stream", stream=>setPeerStreams(prev=>({...prev,[from]:stream})));
      peer.signal(signal);
      peersRef.current[from]=peer;
    });
    socket.on("answer", ({from,signal})=>{
      peersRef.current[from]?.signal(signal);
    });

    return ()=>{ socket.disconnect(); Object.values(peersRef.current).forEach(p=>p.destroy()); peersRef.current={}; }
  },[mediaStream]);

  // --- Auto create peers ---
  useEffect(()=>{
    if(!socketId) return;
    peers.filter(p=>p.id!==socketId).forEach(p=>{
      if(!peersRef.current[p.id]){
        const peer = new Peer({ initiator:true, trickle:false });
        if(mediaStream) mediaStream.getTracks().forEach(t=>peer.addTrack(t,mediaStream));
        peer.on("signal", signal=>socketRef.current.emit("offer",{to:p.id,signal,name}));
        peer.on("stream", stream=>setPeerStreams(prev=>({...prev,[p.id]:stream})));
        peersRef.current[p.id]=peer;
      }
    });
  },[peers, socketId, name, mediaStream]);

  const handleNameEnter = e=>{ if(e.key==="Enter"&&name.trim()) setNameSet(true); };
  const connectToFriend = ()=>{ if(targetId.trim()) socketRef.current.emit("connect-peer",targetId); setTargetId(""); };
  const sendMessage = ()=>{ if(!msg.trim()) return; peers.forEach(p=>socketRef.current.emit("send-message",{to:p.id,msg,name:nameSet?name:""})); setChat(prev=>[...prev,{from:socketId,fromName:"You",msg}]); setMsg(""); };
  const shareVideo = ()=>{ if(videoUrl.trim()){ peers.forEach(p=>socketRef.current.emit("send-video",{to:p.id,url:videoUrl})); setSharedVideoUrl(videoUrl); setVideoUrl(""); } };
  const broadcastAction = action=>{ const t = playerRef.current.getCurrentTime(); peers.forEach(p=>socketRef.current.emit("send-video",{to:p.id,action,time:t})); };
  
  const toggleCam = async ()=>{
    if(meStatus.camOn){ mediaStream?.getVideoTracks().forEach(track=>track.stop()); setMeStatus(s=>({...s,camOn:false})); socketRef.current.emit("update-status",{camOn:false,micOn:meStatus.micOn}); }
    else{ const s=await navigator.mediaDevices.getUserMedia({video:true,audio:meStatus.micOn}); setMediaStream(s); if(myVideoRef.current) myVideoRef.current.srcObject=s; setMeStatus(s=>({...s,camOn:true})); socketRef.current.emit("update-status",{camOn:true,micOn:meStatus.micOn}); }
  };
  const toggleMic = async ()=>{
    if(meStatus.micOn){ mediaStream?.getAudioTracks().forEach(track=>track.stop()); setMeStatus(s=>({...s,micOn:false})); socketRef.current.emit("update-status",{camOn:meStatus.camOn,micOn:false}); }
    else{ const s=await navigator.mediaDevices.getUserMedia({video:meStatus.camOn,audio:true}); setMediaStream(s); if(myVideoRef.current) myVideoRef.current.srcObject=s; setMeStatus(s=>({...s,micOn:true})); socketRef.current.emit("update-status",{camOn:meStatus.camOn,micOn:true}); }
  };
  const leave = ()=>{ socketRef.current.emit("leave"); window.location.reload(); };

  return (
    <div style={{height:"100vh",display:"flex",flexDirection:"column",background:"#090d14",color:"#eee"}}>
      <div style={{padding:10,background:"#121826",display:"flex",justifyContent:"space-between"}}>
        <div style={{fontWeight:700,fontSize:28}}>WatchApp</div>
        {nameSet ? <span>{name} ({socketId})</span> : <input placeholder="Enter name" value={name} onChange={e=>setName(e.target.value)} onKeyDown={handleNameEnter} />}
      </div>
      <div style={{display:"flex",flex:1}}>
        <div style={{flex:2,display:"flex",flexDirection:"column",padding:12}}>
          <div style={{display:"flex"}}>
            <input placeholder="YouTube URL" value={videoUrl} onChange={e=>setVideoUrl(e.target.value)} style={{flex:1}}/>
            <button onClick={shareVideo}>Share</button>
          </div>
          <div style={{flex:1,position:"relative"}}>
            {sharedVideoUrl ? 
              <ReactPlayer url={sharedVideoUrl} ref={playerRef} controls width="100%" height="100%" playing onPlay={()=>broadcastAction("PLAY")} onPause={()=>broadcastAction("PAUSE")} onSeek={(t)=>broadcastAction("SEEK",t)} /> 
              : <span>No video shared yet</span>}
          </div>
        </div>
        <div style={{flex:1,display:"flex",flexDirection:"column",gap:12,padding:12}}>
          <div>
            <input placeholder="Target ID" value={targetId} onChange={e=>setTargetId(e.target.value)} />
            <button onClick={connectToFriend}>Connect</button>
          </div>
          <div style={{flex:1,overflowY:"auto"}}>
            <div>
              <span>{nameSet?name:"You"}</span>
              <video ref={myVideoRef} autoPlay muted playsInline style={{display:meStatus.camOn&&mediaStream?"block":"none"}} />
              <button onClick={toggleCam}>{meStatus.camOn?"Cam On":"Cam Off"}</button>
              <button onClick={toggleMic}>{meStatus.micOn?"Mic On":"Mic Off"}</button>
              <button onClick={leave}>Leave</button>
            </div>
            {peers.filter(p=>p.id!==socketId).map(p=>
              <div key={p.id}>
                <span>{p.name}</span>
                <video autoPlay playsInline muted={!p.micOn} ref={el=>{if(el && peerStreams[p.id] && el.srcObject!==peerStreams[p.id]) el.srcObject=peerStreams[p.id];}} />
                <span>{p.camOn?"Cam On":"Cam Off"}</span>
                <span>{p.micOn?"Mic On":"Mic Off"}</span>
              </div>
            )}
          </div>
          <div>
            <div style={{height:140,overflowY:"auto"}}>
              {chat.map((c,i)=><div key={i}><strong>{c.from===socketId?"You":c.fromName}</strong>: {c.msg}</div>)}
            </div>
            <input placeholder="Message" value={msg} onChange={e=>setMsg(e.target.value)} />
            <button onClick={sendMessage}>Send</button>
          </div>
        </div>
      </div>
    </div>
  );
}
