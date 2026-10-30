/* Configuration publique (aucun secret ici : la clé "publishable" est faite pour être dans la page).
   La clé secrète "service_role" ne doit JAMAIS apparaître dans ce dossier. */
window.TYL_CONFIG = {
  url: 'https://neiyezdentuijvezacfw.supabase.co',
  key: 'sb_publishable_xhqSkWcsFJEYydmH-trb-w_KInWjFp5',
  // signup: true VOLONTAIREMENT (revue mot de passe I5, 30/10) : Lyra n'a pas encore de compte et sa
  // 1re connexion par lien magique en dépend (shouldCreateUser). La barrière réelle est le trigger
  // d'invitation (tyl_require_invite) qui refuse toute adresse non invitée. Limite connue : l'API
  // répond 500 pour une adresse non invitée et 200 pour une invitée (l'écran affiche le même texte).
  // Passer à signup: false ET désactiver « Allow new users to sign up » dès que les 3 comptes existent.
  // flow: 'implicit' seulement pour revenir à l'ancien flux du lien magique (PKCE par défaut).
  // Attention : en flux implicite, un lien forgé peut connecter au compte d'un tiers (login CSRF) ;
  // l'écran « Choisis ton mot de passe » affiche donc le compte concerné.
  signup: true,
  redirect: (location.protocol === 'file:' ? 'http://localhost:5173' : location.origin + location.pathname.replace(/[^\/]*$/, ''))
};

window.TYL_BLOB = window.TYL_CONFIG.url + '/storage/v1/object/public/assets/';
