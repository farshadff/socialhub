from django.urls import path

from . import views

urlpatterns = [
    path("render-templates/", views.RenderTemplatesView.as_view(), name="render-templates"),
    path("content-items/<int:pk>/production/", views.ProductionView.as_view(),
         name="production"),
    path("content-items/<int:pk>/production/start/", views.ProductionStartView.as_view(),
         name="production-start"),
    path("content-items/<int:pk>/production/render/", views.ProductionRenderView.as_view(),
         name="production-render"),
    path("content-items/<int:pk>/production/frames/<int:index>/",
         views.ProductionFrameView.as_view(), name="production-frame"),
    path("content-items/<int:pk>/production/clips/", views.ProductionClipsView.as_view(),
         name="production-clips"),
    path("content-items/<int:pk>/production/generate-image/",
         views.ProductionGenerateImageView.as_view(), name="production-generate-image"),
    path("content-items/<int:pk>/production/final-asset/",
         views.ProductionFinalAssetView.as_view(), name="production-final-asset"),
    path("content-items/<int:pk>/production/submit/", views.ProductionSubmitView.as_view(),
         name="production-submit"),
    path("content-items/<int:pk>/copy/generate/", views.CopyGenerateView.as_view(),
         name="copy-generate"),
    path("content-items/<int:pk>/copy/", views.CopyView.as_view(), name="copy"),
]
