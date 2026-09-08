flowchart TB
  subgraph Vendor[SuperDoc vendor components]
    Provider[SuperDocUIProvider]
    SuperDocEditor[SuperDoc editor]
    SuperDocToolbar[SuperDoc toolbar]
    SuperDocRuler[SuperDoc ruler]
  end

  subgraph Demo[Inline revisions demo components]
    App[App]
    Topbar[Topbar]
    StyleGallery[StyleGallery]
    Editor[SuperDocEditor]
    CommentsRail[CommentsRail]
  end

  Provider --> App
  App --> Topbar
  App --> Editor
  App --> CommentsRail
  Topbar --> StyleGallery
  Topbar --> SuperDocToolbar
  Editor --> SuperDocEditor
  Editor --> SuperDocRuler
