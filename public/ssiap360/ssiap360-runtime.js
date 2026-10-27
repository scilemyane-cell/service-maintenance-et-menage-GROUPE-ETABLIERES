/* SSIAP360 – environnement intégré à l'appli Service Maintenance et Ménage.
   Remplace l'hébergement claude.ai / api.php : la base de données, la salle
   de formation (messages + présence) et les droits « formateur » passent par
   le Firebase de l'appli SMM.
   • Données : chaque chemin « collection/doc » de SSIAP360 est rangé dans la
     collection Firestore « ssiap360-<collection> » (aucun mélange avec SMM).
   • Droits d'édition (formateur, planning, admin) : comptes SMM super admin,
     admin et superviseur (n1). Les autres (ou un stagiaire sans compte, connecté
     anonymement) utilisent l'appli normalement. */
(function () {
  if (window.claude && window.claude.use) return;
  // Hébergé dans l'appli SMM : licence interne Groupe Établières, tous modules.
  window.SSIAP360_LICENCE_INTERNE = { v: 1, c: "Groupe Établières (usage interne)", id: "SMM-INTERNE", exp: "2099-12-31", m: null, n: 0 };
  var V = "10.14.1", G = "https://www.gstatic.com/firebasejs/" + V + "/";
  var pret = (async function () {
    var [{ app, auth, db: fdb }, fs, fa] = await Promise.all([
      import("../js/firebase-init.js"), import(G + "firebase-firestore.js"), import(G + "firebase-auth.js"),
    ]);
    var user = await new Promise(function (ok) { var u = fa.onAuthStateChanged(auth, function (x) { u(); ok(x); }); });
    if (!user) user = (await fa.signInAnonymously(auth)).user;
    void app;
    return { auth: auth, fdb: fdb, fs: fs, user: user };
  })();

  function chemin(path) {
    var p = String(path).split("/").filter(Boolean);
    return p.map(function (x, i) { return i % 2 === 0 ? "ssiap360-" + x : x; });
  }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function docSnap(id, exists, data) {
    return { id: id, exists: !!exists, data: function () { return exists ? clone(data) : undefined; }, get: function (f) { return exists ? (data || {})[f] : undefined; } };
  }
  function colSnap(docs) {
    return { docs: docs, size: docs.length, empty: !docs.length, forEach: function (f) { docs.forEach(f); }, docChanges: function () { return []; } };
  }
  function erreur(e) { var x = new Error(e && e.message || "Erreur base de données"); x.code = e && e.code === "permission-denied" ? "permission_denied" : "unavailable"; return x; }

  function docRef(env, path) {
    var segs = chemin(path), id = segs[segs.length - 1], fs = env.fs, ref = fs.doc(env.fdb, segs.join("/"));
    return {
      id: id, path: path,
      get: function () { return fs.getDoc(ref).then(function (s) { return docSnap(id, s.exists(), s.data()); }, function (e) { throw erreur(e); }); },
      set: function (d) { return fs.setDoc(ref, clone(d)).then(function () {}, function (e) { throw erreur(e); }); },
      update: function (d) {
        return fs.updateDoc(ref, clone(d)).catch(function (e) { if (e && e.code === "not-found") return fs.setDoc(ref, clone(d), { merge: true }); throw e; })
          .then(function () {}, function (e) { throw erreur(e); });
      },
      delete: function () { return fs.deleteDoc(ref).then(function () {}, function (e) { throw erreur(e); }); },
      onSnapshot: function (fn, err) {
        return fs.onSnapshot(ref, function (s) { fn(docSnap(id, s.exists(), s.data())); }, function (e) { if (err) err(erreur(e)); });
      },
      collection: function (sub) { return colRef(env, path + "/" + sub); },
    };
  }
  function colRef(env, path) {
    var fs = env.fs, q = { w: [], o: null, l: 0 };
    var cref = fs.collection(env.fdb, chemin(path).join("/"));
    function requete() {
      var c = [cref];
      q.w.forEach(function (w) { c.push(fs.where(w[0], w[1] === "eq" ? "==" : w[1], w[2])); });
      if (q.o) c.push(fs.orderBy(q.o[0], q.o[1] === "desc" ? "desc" : "asc"));
      if (q.l) c.push(fs.limit(q.l));
      return c.length > 1 ? fs.query.apply(null, c) : cref;
    }
    function vers(s) { return colSnap(s.docs.map(function (d) { return docSnap(d.id, true, d.data()); })); }
    var api = {
      path: path,
      doc: function (id) { return docRef(env, path + "/" + (id || ("d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)))); },
      add: function (d) { var r = api.doc(); return r.set(d).then(function () { return r; }); },
      where: function (f, op, v) { q.w.push([f, op, v]); return api; },
      orderBy: function (f, d) { q.o = [f, d]; return api; },
      limit: function (n) { q.l = n; return api; },
      get: function () { return fs.getDocs(requete()).then(vers, function (e) { throw erreur(e); }); },
      onSnapshot: function (fn, err) { return fs.onSnapshot(requete(), function (s) { fn(vers(s)); }, function (e) { if (err) err(erreur(e)); }); },
    };
    return api;
  }

  /* Salle de formation : messages diffusés + présence des participants. */
  function salle(env) {
    var fs = env.fs, me = "p" + Math.random().toString(36).slice(2, 10), L = {}, PF = [], pres = {}, demarre = false, debut = Date.now();
    var msgs = fs.collection(env.fdb, "ssiap360-salle-messages"), peers = fs.collection(env.fdb, "ssiap360-salle-presence");
    function boucle() {
      if (demarre) return; demarre = true;
      fs.onSnapshot(fs.query(msgs, fs.where("t", ">", debut)), function (s) {
        s.docChanges().forEach(function (ch) {
          if (ch.type !== "added") return;
          var x = ch.doc.data(); if (x.peer === me) return;
          (L[x.topic] || []).forEach(function (f) { try { f({ topic: x.topic, data: x.data, peer: x.peer, isMe: false, sameTab: false, kind: "viewer", guest: false, by: null }); } catch (e) {} });
        });
      }, function () {});
      fs.onSnapshot(peers, function (s) {
        var lim = Date.now() - 20000;
        var arr = s.docs.map(function (d) { return d.data(); }).filter(function (x) { return x.t > lim; }).map(function (x) {
          return { peer: x.peer, by: null, isMe: x.peer === me, sameTab: x.peer === me, kind: "viewer", guest: false, presence: x.p || {}, updatedAt: x.t };
        });
        PF.forEach(function (f) { try { f({ peers: arr, joined: [], left: [], updated: arr }); } catch (e) {} });
      }, function () {});
      var battre = function () { fs.setDoc(fs.doc(peers, me), { peer: me, p: clone(pres), t: Date.now() }).catch(function () {}); };
      battre(); setInterval(battre, 8000);
      window.addEventListener("pagehide", function () { fs.deleteDoc(fs.doc(peers, me)).catch(function () {}); });
    }
    return {
      emit: function (topic, data) {
        (L[topic] || []).forEach(function (f) { try { f({ topic: topic, data: data, peer: me, isMe: true, sameTab: true }); } catch (e) {} });
        return fs.addDoc(msgs, { topic: topic, data: clone(data) === undefined ? null : clone(data), peer: me, t: Date.now() }).then(function () {});
      },
      on: function (t, f) { boucle(); (L[t] = L[t] || []).push(f); return function () { L[t] = (L[t] || []).filter(function (x) { return x !== f; }); }; },
      presence: function (p) { boucle(); for (var k in p) pres[k] = p[k]; return fs.setDoc(fs.doc(peers, me), { peer: me, p: clone(pres), t: Date.now() }).then(function () {}); },
      onPeers: function (f) { boucle(); PF.push(f); return function () { PF = PF.filter(function (x) { return x !== f; }); }; },
      peers: function () { return []; },
    };
  }

  var downloads = {
    save: function (o) {
      var b = o.data instanceof Blob ? o.data : new Blob([o.data], { type: "application/octet-stream" });
      var a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = o.filename || "fichier";
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      return Promise.resolve();
    },
  };

  var cache = {};
  window.claude = {
    use: function (n) {
      if (n === "downloads") return Promise.resolve(downloads);
      if (cache[n]) return cache[n];
      cache[n] = pret.then(function (env) {
        if (n === "db") return { doc: function (p) { return docRef(env, p); }, collection: function (p) { return colRef(env, p); } };
        if (n === "room") return salle(env);
        if (n === "user") return {
          canEdit: function () {
            if (env.user.isAnonymous) return Promise.resolve(false);
            return env.fs.getDoc(env.fs.doc(env.fdb, "users", env.user.uid)).then(function (s) {
              var r = s.exists() ? s.data().role : null;
              // Super administrateur SMM : administrateur SSIAP360 d'office.
              if (r === "super_admin") window.SSIAP360_SMM_ADMIN = true;
              return r === "super_admin" || r === "admin" || r === "n1";
            }).catch(function () { return false; });
          },
          id: function () { return Promise.resolve(env.user.uid); },
        };
        return null;
      }).catch(function (e) { console.error("SSIAP360 :", e); return n === "downloads" ? downloads : null; });
      return cache[n];
    },
  };
})();
