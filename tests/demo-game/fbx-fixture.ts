// Original, minimal ASCII FBX 7.4 fixture: a tetrahedron with a rotation clip.
export function animatedFbx() {
  return `; FBX 7.4.0 project file
FBXHeaderExtension:  {
\tFBXHeaderVersion: 1003
\tFBXVersion: 7400
}

Objects:  {
\tGeometry: 1000, "Geometry::Tetrahedron", "Mesh" {
\t\tVertices: *12 {
\t\t\ta: 0,1,0,-1,-1,1,1,-1,1,0,-1,-1
\t\t}
\t\tPolygonVertexIndex: *12 {
\t\t\ta: 0,1,-3,0,2,-4,0,3,-2,1,3,-3
\t\t}
\t}
\tModel: 2000, "Model::Tetrahedron", "Mesh" {
\t\tVersion: 232
\t\tProperties70:  {
\t\t\tP: "Lcl Translation", "Lcl Translation", "", "A",0,0,0
\t\t\tP: "Lcl Rotation", "Lcl Rotation", "", "A",0,0,0
\t\t\tP: "Lcl Scaling", "Lcl Scaling", "", "A",1,1,1
\t\t}
\t}
\tMaterial: 3000, "Material::Gold", "" {
\t\tVersion: 102
\t\tShadingModel: "phong"
\t\tProperties70:  {
\t\t\tP: "DiffuseColor", "Color", "", "A",0.8,0.45,0.1
\t\t\tP: "Shininess", "double", "Number", "",30
\t\t}
\t}
\tAnimationCurveNode: 4000, "AnimCurveNode::R", "" {
\t\tProperties70:  {
\t\t\tP: "d|Y", "Number", "", "A",0
\t\t}
\t}
\tAnimationCurve: 5000, "AnimCurve::Y", "" {
\t\tKeyTime: *3 {
\t\t\ta: 0,46186158000,92372316000
\t\t}
\t\tKeyValueFloat: *3 {
\t\t\ta: 0,90,0
\t\t}
\t}
\tAnimationCurve: 5001, "AnimCurve::X", "" {
\t\tKeyTime: *3 {
\t\t\ta: 0,46186158000,92372316000
\t\t}
\t\tKeyValueFloat: *3 {
\t\t\ta: 0,0,0
\t\t}
\t}
\tAnimationCurve: 5002, "AnimCurve::Z", "" {
\t\tKeyTime: *3 {
\t\t\ta: 0,46186158000,92372316000
\t\t}
\t\tKeyValueFloat: *3 {
\t\t\ta: 0,0,0
\t\t}
\t}
\tAnimationLayer: 6000, "AnimLayer::BaseLayer", "" {
\t}
\tAnimationStack: 7000, "AnimStack::Idle", "" {
\t}
}
Connections:  {
\tC: "OO",1000,2000
\tC: "OO",3000,2000
\tC: "OO",2000,0
\tC: "OP",4000,2000,"Lcl Rotation"
\tC: "OP",5000,4000,"d|Y"
\tC: "OP",5001,4000,"d|X"
\tC: "OP",5002,4000,"d|Z"
\tC: "OO",4000,6000
\tC: "OO",6000,7000
}
`;
}

export function texturedFbx() {
  return animatedFbx().replace('Objects:  {', `Objects:  {
\tVideo: 8000, "Video::Pixel", "Clip" {
\t\tFilename: "__viewer-qa-pixel.png"
\t\tRelativeFilename: "__viewer-qa-pixel.png"
\t}
\tTexture: 9000, "Texture::Pixel", "" {
\t\tType: "TextureVideoClip"
\t\tFileName: "__viewer-qa-pixel.png"
\t\tRelativeFilename: "__viewer-qa-pixel.png"
\t}
`).replace('Connections:  {', `Connections:  {
\tC: "OO",8000,9000
\tC: "OP",9000,3000,"DiffuseColor"
`);
}
